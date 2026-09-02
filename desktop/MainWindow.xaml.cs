using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace GuestVoiceStudio;

/// <summary>
/// Thin desktop shell: hosts the existing web app (webapp/) inside WebView2
/// with no server and no admin rights. All data lives under
/// %LOCALAPPDATA%\GuestVoiceStudio (WebView2's per-user profile + browser
/// localStorage), matching the local-app / no-elevation requirements in
/// customer_voice_requirements_local_v2.docx (§7 保存先, §7 管理者権限).
///
/// Native bridge (JS -> C# via window.chrome.webview.postMessage, one call =
/// one JSON request/response correlated by requestId) is kept deliberately
/// small — 7 generic commands instead of one method per feature — so the web
/// layer stays testable in a plain browser too (js/native.js feature-detects
/// window.__NATIVE__ and falls back to normal browser APIs when absent).
/// </summary>
public partial class MainWindow : Window
{
    // Bump both with every release. Shown in Settings＞ブランド・保存設定
    // ("このツールについて") so a tester can tell at a glance whether they're
    // actually running the build they think they extracted — real-machine
    // feedback repeatedly turned out to be re-testing a stale exe via an old
    // desktop shortcut (see EnsureDesktopShortcut).
    private const string AppVersion = "2.11.0";
    private const string AppVersionDate = "2026年9月2日";

    private string _dataDir = "";
    // Startup splash must stay up at least this long — the app loads so fast
    // on modern hardware that it used to flash and disappear before the user
    // could read the logo/tagline. (v1: 1s → v2: 3s per feedback; the 3s was
    // correct all along — a separate bug was cutting the *logo itself* short
    // and replacing it with a blank white WebView2 surface for the remainder,
    // see Browser.Visibility handling below.)
    private static readonly TimeSpan MinSplashDuration = TimeSpan.FromSeconds(3);
    private readonly Stopwatch _splashStopwatch = Stopwatch.StartNew();
    private static readonly double[] ZoomSteps = { 0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0 };

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            EnsureDesktopShortcut(this);
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            LoadingOverlay.Visibility = Visibility.Visible;
            var bundledExists = Directory.Exists(Path.Combine(AppContext.BaseDirectory, "webview2runtime"));
            MessageBox.Show(
                "WebView2 ランタイムの初期化に失敗しました。\n\n" +
                (bundledExists
                    ? "同梱ランタイム（webview2runtime フォルダ）を検出しましたが、読み込みに失敗しました。exeと同じ場所に webview2runtime フォルダが正しくコピーされているかご確認ください。"
                    : "同梱ランタイム（webview2runtime フォルダ）が見つかりませんでした。exeと同じ場所に webview2runtime フォルダを配置してください（別配布のZIPをご利用の場合は展開後のフォルダ構成をご確認ください）。") +
                "\n\n詳細: " + ex.Message,
                "起動エラー", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        var appRoot = ResolveDataRoot();
        _dataDir = appRoot;
        Directory.CreateDirectory(appRoot);
        Directory.CreateDirectory(Path.Combine(appRoot, "Reports"));
        Directory.CreateDirectory(Path.Combine(appRoot, "Backups"));
        var webViewUserData = Path.Combine(appRoot, "WebView2Data");
        Directory.CreateDirectory(webViewUserData);

        // Prefer the WebView2 Runtime bundled next to the exe (webview2runtime\)
        // so the app never depends on a system-installed runtime — this is
        // what fixes the "WebView2ランタイムの初期化に失敗しました" /
        // 0x80070003 error on machines that don't already have Edge's
        // Evergreen runtime present (common on locked-down Windows 10).
        // Falls back to the system runtime if the bundled folder is missing
        // (e.g. a debug build run without first running fetch_webview2_runtime.ps1).
        var bundledRuntime = Path.Combine(AppContext.BaseDirectory, "webview2runtime");
        string? browserExecutableFolder = Directory.Exists(bundledRuntime) && File.Exists(Path.Combine(bundledRuntime, "msedgewebview2.exe"))
            ? bundledRuntime
            : null;

        CoreWebView2Environment env;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: browserExecutableFolder, userDataFolder: webViewUserData);
        }
        catch (Exception) when (browserExecutableFolder != null)
        {
            // Bundled runtime present but failed to load for some reason — retry
            // against whatever system runtime might be available as a last resort.
            env = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewUserData);
        }
        await Browser.EnsureCoreWebView2Async(env);

        var webAppDir = Path.Combine(AppContext.BaseDirectory, "webapp");
        const string virtualHost = "appassets.local";
        Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
            virtualHost, webAppDir, CoreWebView2HostResourceAccessKind.Allow);

        // Clear ONLY the HTTP disk/memory cache on every launch — not
        // cookies/localStorage/IndexedDB, which is where all of this app's
        // actual data (survey records, tasks, settings) lives and must
        // persist across versions. WebView2's cache otherwise persists
        // alongside that data (both live under _dataDir\WebView2Data), so a
        // stylesheet or ES module fetched once under an older version could
        // keep being served from cache after upgrading even though the
        // on-disk file had changed — several "still not fixed" reports for
        // CSS/JS-only changes were consistent with exactly this. (An
        // earlier attempt at fixing this by versioning the virtual host
        // name itself was reverted — that would have partitioned
        // localStorage by origin too, silently wiping all user data on
        // every version upgrade.)
        try
        {
            await Browser.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
        }
        catch
        {
            // Older WebView2 runtime without Profile.ClearBrowsingDataAsync — not fatal.
        }

        var nativeContext = JsonSerializer.Serialize(new
        {
            isDesktop = true,
            dataDir = _dataDir,
            reportsDir = Path.Combine(_dataDir, "Reports"),
            backupsDir = Path.Combine(_dataDir, "Backups"),
            bridgeLogPath = Path.Combine(_dataDir, "bridge.log"),
            appVersion = AppVersion,
            appVersionDate = AppVersionDate,
            windowsUserName = Environment.UserName,
        });
        await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            $"window.__NATIVE__ = {nativeContext};");

        Browser.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
        Browser.CoreWebView2.NavigationCompleted += async (_, args) =>
        {
            if (!args.IsSuccess) return;
            var remaining = MinSplashDuration - _splashStopwatch.Elapsed;
            if (remaining > TimeSpan.Zero) await System.Threading.Tasks.Task.Delay(remaining);
            // Reveal Browser and hide the splash together — see the
            // Visibility="Hidden" comment on Browser in MainWindow.xaml for
            // why Browser can't just sit behind LoadingOverlay the whole time.
            Browser.Visibility = Visibility.Visible;
            LoadingOverlay.Visibility = Visibility.Collapsed;
        };

        Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        Browser.CoreWebView2.Settings.AreDevToolsEnabled = true; // left on to support field troubleshooting

        Browser.CoreWebView2.Navigate($"https://{virtualHost}/index.html?v={Uri.EscapeDataString(AppVersion)}");
    }

    /// <summary>
    /// Steps ZoomFactor to the next value in ZoomSteps in the given
    /// direction (+1/-1), snapping to the nearest step first if the current
    /// factor isn't exactly on one (e.g. it was last changed via Ctrl+wheel).
    /// </summary>
    private double StepZoom(int direction)
    {
        var current = Browser.ZoomFactor;
        var idx = Array.FindIndex(ZoomSteps, s => Math.Abs(s - current) < 0.01);
        int nextIdx;
        if (idx < 0)
        {
            nextIdx = direction > 0
                ? Array.FindIndex(ZoomSteps, s => s > current)
                : Array.FindLastIndex(ZoomSteps, s => s < current);
            if (nextIdx < 0) nextIdx = direction > 0 ? ZoomSteps.Length - 1 : 0;
        }
        else
        {
            nextIdx = Math.Clamp(idx + direction, 0, ZoomSteps.Length - 1);
        }
        Browser.ZoomFactor = ZoomSteps[nextIdx];
        return Browser.ZoomFactor;
    }

    /// <summary>
    /// Where app data lives is chosen once, on first launch, per the request
    /// to make the save location configurable during initial setup rather
    /// than buried in Settings. A small locator file at a FIXED, well-known
    /// path (%LOCALAPPDATA%\GuestVoiceStudio.location) — itself never
    /// user-relocatable — records where the real data folder actually is, so
    /// later launches can find it even if the user picked a custom drive.
    /// </summary>
    private string ResolveDataRoot()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var defaultRoot = Path.Combine(localAppData, "GuestVoiceStudio");
        var locatorPath = Path.Combine(localAppData, "GuestVoiceStudio.location");

        if (File.Exists(locatorPath))
        {
            var saved = File.ReadAllText(locatorPath).Trim();
            if (!string.IsNullOrWhiteSpace(saved)) return saved;
        }

        // First launch: let the user confirm or change where data is saved.
        var chosen = defaultRoot;
        var result = MessageBox.Show(
            "データの保存先（初期設定）\n\n" +
            $"既定の保存先:\n{defaultRoot}\n\n" +
            "この場所でよろしいですか？\n「いいえ」を選ぶと保存先フォルダを選択できます。",
            "初期設定 - 保存先の選択", MessageBoxButton.YesNo, MessageBoxImage.Question);

        if (result == MessageBoxResult.No)
        {
            var dlg = new OpenFolderDialog
            {
                Title = "データの保存先フォルダを選択してください",
                Multiselect = false,
            };
            if (dlg.ShowDialog(this) == true && !string.IsNullOrWhiteSpace(dlg.FolderName))
            {
                chosen = dlg.FolderName;
            }
        }

        Directory.CreateDirectory(chosen);
        File.WriteAllText(locatorPath, chosen);
        return chosen;
    }

    /// <summary>
    /// Asks (once ever) whether to create a Desktop shortcut, pre-checked
    /// checkbox. Then, on THIS and every subsequent launch, makes sure the
    /// shortcut actually exists and points at the currently-running exe —
    /// recreating it from scratch if it's missing, not just updating it if
    /// present.
    ///
    /// The "recreate if missing" half matters because moving/renaming the
    /// extracted app folder in Explorer (e.g. to relocate it, or replacing
    /// an old version's folder with a new one) breaks the old .lnk outright
    /// — Windows shows a "this shortcut is no longer valid" error and never
    /// launches the exe at all, so a "fix it after launch" approach can't
    /// help; the shortcut has to be rebuilt proactively instead. Consent is
    /// only asked once — a "no" is remembered (not re-prompted), and a
    /// "yes" means the shortcut gets silently rebuilt whenever it goes
    /// missing, without asking again.
    ///
    /// Uses a NEW marker filename (.shortcut-prompted-v2, not the old
    /// .shortcut-created) deliberately: v2.1's shortcut feature created that
    /// old marker unconditionally on first run, before this consent dialog
    /// existed, so every install upgrading from v2.1 already had it and the
    /// dialog would otherwise never appear even once.
    /// </summary>
    private static void EnsureDesktopShortcut(Window owner)
    {
        try
        {
            var markerPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GuestVoiceStudio.shortcut-prompted-v2");

            bool consented;
            if (File.Exists(markerPath))
            {
                // v2.4.0–v2.6.0 wrote an ISO timestamp here (unconditionally,
                // whenever a shortcut had already been created some other
                // way) — not the literal "true"/"false" this version reads.
                // Treating anything other than an explicit "false" as
                // consent (rather than requiring an exact "true" match)
                // means installs upgrading from those versions keep their
                // shortcut instead of silently losing it: reading a legacy
                // timestamp as "declined" was a real bug — a user who
                // deleted their shortcut to test recreating it found it
                // never came back, because their marker predated this
                // format and got misread as "no".
                consented = File.ReadAllText(markerPath).Trim() != "false";
            }
            else
            {
                consented = ShowShortcutConsentDialog(owner);
                File.WriteAllText(markerPath, consented ? "true" : "false");
            }
            if (!consented) return;

            // Keep a copy of the icon at a FIXED path outside the (movable/
            // replaceable) extracted app folder, and point the shortcut's
            // icon at that copy rather than at "exePath,0". Icons resolved
            // via "exePath,0" go blank/generic the moment that exe path
            // stops existing — e.g. the user moves the extracted folder
            // elsewhere — even though TargetPath itself gets self-healed on
            // the next launch from the new location. Refreshed every launch
            // so a future icon change still propagates.
            var stableIconPath = EnsureStableIconFile();

            var desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktopDir, "Guest Voice Studio.lnk");
            var exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "GuestVoiceStudio.exe");
            var iconLocation = (stableIconPath ?? exePath) + ",0";

            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var shortcut = shell.CreateShortcut(shortcutPath);
            var alreadyCorrect = File.Exists(shortcutPath)
                && string.Equals((string)shortcut.TargetPath, exePath, StringComparison.OrdinalIgnoreCase)
                && string.Equals((string)shortcut.IconLocation, iconLocation, StringComparison.OrdinalIgnoreCase);
            if (alreadyCorrect) return; // avoid rewriting the .lnk on every single launch

            shortcut.TargetPath = exePath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(exePath);
            shortcut.IconLocation = iconLocation;
            shortcut.Description = "お客様の声・改善管理（Guest Voice Studio）";
            shortcut.Save();
        }
        catch
        {
            // Best-effort — worst case the shortcut stays stale until next launch.
        }
    }

    /// <summary>
    /// Copies the app icon (embedded as a WPF pack resource, Assets/app.ico)
    /// out to a fixed, never-relocated path — %LOCALAPPDATA%\GuestVoiceStudio.ico
    /// — and returns that path, or null if the copy failed.
    ///
    /// Deliberately a bare file directly under %LOCALAPPDATA%, NOT inside
    /// the "GuestVoiceStudio" subfolder — that subfolder is also the
    /// *default* data root (see ResolveDataRoot), and Settings＞保存先を変更
    /// moves that entire folder's contents elsewhere. An icon file living
    /// inside it would get swept away by that move, defeating the point of
    /// having a location that survives every kind of relocation.
    /// </summary>
    private static string? EnsureStableIconFile()
    {
        try
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var stableIconPath = Path.Combine(localAppData, "GuestVoiceStudio.ico");

            var resourceInfo = Application.GetResourceStream(new Uri("Assets/app.ico", UriKind.Relative));
            if (resourceInfo == null) return null;
            using (var src = resourceInfo.Stream)
            using (var dst = File.Create(stableIconPath))
            {
                src.CopyTo(dst);
            }
            return stableIconPath;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Small inline confirmation dialog (checkbox pre-checked) — kept as
    /// plain code-behind UI rather than a separate .xaml so the shortcut
    /// consent flow doesn't need its own window resource.
    /// </summary>
    private static bool ShowShortcutConsentDialog(Window owner)
    {
        var win = new Window
        {
            Title = "デスクトップショートカット",
            Width = 420,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = owner,
            ResizeMode = ResizeMode.NoResize,
            Background = System.Windows.Media.Brushes.White,
        };
        var panel = new StackPanel { Margin = new Thickness(20) };
        panel.Children.Add(new TextBlock
        {
            Text = "デスクトップに「Guest Voice Studio」のショートカットを作成しますか？",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 14),
        });
        var chk = new CheckBox { Content = "デスクトップにショートカットを作成する", IsChecked = true, Margin = new Thickness(0, 0, 0, 18) };
        panel.Children.Add(chk);
        var btnPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var okBtn = new Button { Content = "OK", Width = 90, Padding = new Thickness(0, 6, 0, 6), IsDefault = true };
        var result = false;
        okBtn.Click += (_, _) => { result = chk.IsChecked == true; win.Close(); };
        btnPanel.Children.Add(okBtn);
        panel.Children.Add(btnPanel);
        win.Content = panel;
        win.ShowDialog();
        return result;
    }

    /// <summary>
    /// Shows a Win32 common file/folder dialog reliably from a WebView2
    /// message handler. WebView2 hosts its content in a separate child HWND
    /// (a different process, even) that can still hold input focus/activation
    /// at the moment the postMessage that triggers this arrives. Calling
    /// ShowDialog() straight from there sometimes opens the picker without
    /// activating it — it ends up non-topmost, behind the WebView2 surface,
    /// which reads to the user as "nothing happens" (a toast fires but no
    /// picker is visible or clickable). Explicitly activating this window
    /// first, and yielding once so the WebView2 message pump settles before
    /// the modal loop takes over, fixes that.
    /// </summary>
    private async Task<bool?> ShowNativeDialogAsync(Func<bool?> showDialog)
    {
        await Dispatcher.Yield(DispatcherPriority.Background);
        Activate();
        Topmost = true;
        try
        {
            return showDialog();
        }
        finally
        {
            Topmost = false;
        }
    }

    // v2.11: PDF保存・Wordダウンロードとも、実機で「トーストすら出ずに何も
    // 起きない」という報告が複数ラウンド続いた。この環境ではWebView2の実GUIを
    // 動かして再現できないため、原因を推測で直し続けるのではなく、次に同じ
    // 状況が起きたときに実際の失敗理由（例外・タイムアウト・そもそも到達して
    // いない等）が分かるよう、全コマンドの受信・応答をこのログに記録する。
    // Settings画面の「診断ログを開く」から参照できる。
    private void LogBridge(string message)
    {
        try
        {
            if (string.IsNullOrEmpty(_dataDir)) return;
            var logPath = Path.Combine(_dataDir, "bridge.log");
            File.AppendAllText(logPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch { }
    }

    private async void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string? requestId = null;
        string? typeForLog = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
            typeForLog = type;
            LogBridge($"received type={type}");
            requestId = root.TryGetProperty("requestId", out var ridEl) ? ridEl.GetString() : null;

            switch (type)
            {
                case "openPath":
                {
                    // Previously always replied {ok:true} even when the file
                    // was missing or had no associated app, which silently
                    // swallowed failures (e.g. no default .eml handler) —
                    // the JS side would show a success toast for something
                    // that never actually opened. Now reports truthfully.
                    var path = root.GetProperty("path").GetString();
                    if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                    {
                        Reply(requestId, new { ok = false, error = "file-not-found" });
                        break;
                    }
                    try
                    {
                        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                        Reply(requestId, new { ok = true });
                    }
                    catch (Exception ex)
                    {
                        Reply(requestId, new { ok = false, error = ex.Message });
                    }
                    break;
                }
                case "revealInExplorer":
                {
                    // Accepts either a folder (opens it) or a file (opens its
                    // parent folder with the file pre-selected/highlighted) —
                    // used after a direct PDF/Word save so the user can see
                    // exactly where the file landed without hunting for it.
                    var path = root.GetProperty("path").GetString();
                    if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
                    else if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
                        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
                    Reply(requestId, new { ok = true });
                    break;
                }
                case "pickSaveFile":
                {
                    var suggestedName = root.TryGetProperty("suggestedName", out var sn) ? sn.GetString() : "file";
                    var filter = root.TryGetProperty("filter", out var f) ? f.GetString() : "All files (*.*)|*.*";
                    var initialDirectory = root.TryGetProperty("initialDirectory", out var idEl) ? idEl.GetString() : null;
                    var dlg = new SaveFileDialog { FileName = suggestedName, Filter = filter };
                    if (!string.IsNullOrWhiteSpace(initialDirectory) && Directory.Exists(initialDirectory))
                        dlg.InitialDirectory = initialDirectory;
                    var result = await ShowNativeDialogAsync(() => dlg.ShowDialog(this));
                    Reply(requestId, new { ok = result == true, path = result == true ? dlg.FileName : null });
                    break;
                }
                case "pickOpenFile":
                {
                    var filter = root.TryGetProperty("filter", out var f) ? f.GetString() : "All files (*.*)|*.*";
                    var dlg = new OpenFileDialog { Filter = filter };
                    var result = await ShowNativeDialogAsync(() => dlg.ShowDialog(this));
                    Reply(requestId, new { ok = result == true, path = result == true ? dlg.FileName : null });
                    break;
                }
                case "pickFolder":
                {
                    var title = root.TryGetProperty("title", out var tEl) ? tEl.GetString() : "フォルダを選択してください";
                    var dlg = new OpenFolderDialog { Title = title, Multiselect = false };
                    var result = await ShowNativeDialogAsync(() => dlg.ShowDialog(this));
                    Reply(requestId, new { ok = result == true, path = result == true ? dlg.FolderName : null });
                    break;
                }
                case "requestRelocateData":
                {
                    // Confirmation ("移動してアプリを再起動しますか？") already
                    // happened on the JS side. The move itself can't happen
                    // while this process is running — WebView2's browser
                    // profile (cookies/localStorage) under _dataDir\WebView2Data
                    // is actively open — so, like requestUninstall, this hands
                    // off to a detached helper that waits for us to exit,
                    // moves everything, updates the locator file, then
                    // relaunches the app from its new data location.
                    var newDir = root.GetProperty("newDataDir").GetString();
                    if (string.IsNullOrWhiteSpace(newDir))
                    {
                        Reply(requestId, new { ok = false, error = "no-target-folder" });
                        break;
                    }
                    if (string.Equals(Path.GetFullPath(newDir).TrimEnd('\\'), Path.GetFullPath(_dataDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                    {
                        Reply(requestId, new { ok = false, error = "same-location" });
                        break;
                    }
                    Reply(requestId, new { ok = true });
                    await System.Threading.Tasks.Task.Delay(300);
                    StartRelocateHelperAndExit(newDir);
                    break;
                }
                case "getZoom":
                {
                    Reply(requestId, new { ok = true, factor = Browser.ZoomFactor });
                    break;
                }
                case "setZoom":
                {
                    var factor = root.GetProperty("factor").GetDouble();
                    Browser.ZoomFactor = Math.Clamp(factor, 0.25, 3.0);
                    Reply(requestId, new { ok = true, factor = Browser.ZoomFactor });
                    break;
                }
                case "stepZoom":
                {
                    // direction: +1 to zoom in, -1 to zoom out.
                    var direction = root.GetProperty("direction").GetInt32();
                    var newFactor = StepZoom(direction);
                    Reply(requestId, new { ok = true, factor = newFactor });
                    break;
                }
                case "printToPdf":
                {
                    var path = root.GetProperty("path").GetString()!;
                    LogBridge($"printToPdf: path={path}");
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    // WebView2's headless PrintToPdfAsync has a known failure
                    // mode on some machines (e.g. Print Spooler service
                    // disabled/restricted — common in hardened corporate
                    // environments) where it never completes and never
                    // throws — the await just hangs forever, which reads to
                    // the user as "a toast said it's saving, then nothing".
                    // Racing it against a timeout turns that silent hang into
                    // a visible, logged failure instead.
                    var printTask = Browser.CoreWebView2.PrintToPdfAsync(path);
                    var winner = await System.Threading.Tasks.Task.WhenAny(printTask, System.Threading.Tasks.Task.Delay(TimeSpan.FromSeconds(20)));
                    if (winner != printTask)
                    {
                        LogBridge($"printToPdf: TIMEOUT after 20s, path={path}");
                        Reply(requestId, new { ok = false, error = "timeout" });
                        break;
                    }
                    var success = await printTask;
                    LogBridge($"printToPdf: done success={success}, path={path}, exists={File.Exists(path)}");
                    Reply(requestId, new { ok = success, path });
                    break;
                }
                case "readFileBytes":
                {
                    var path = root.GetProperty("path").GetString()!;
                    var bytes = await File.ReadAllBytesAsync(path);
                    Reply(requestId, new { ok = true, base64 = Convert.ToBase64String(bytes) });
                    break;
                }
                case "writeFileBytes":
                {
                    var path = root.GetProperty("path").GetString()!;
                    var base64 = root.GetProperty("base64").GetString()!;
                    LogBridge($"writeFileBytes: path={path}, base64Len={base64.Length}");
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    await File.WriteAllBytesAsync(path, Convert.FromBase64String(base64));
                    LogBridge($"writeFileBytes: done, path={path}, exists={File.Exists(path)}");
                    Reply(requestId, new { ok = true, path });
                    break;
                }
                case "requestUninstall":
                {
                    // Confirmation already happened on the JS side (Settings＞
                    // ブランド・保存設定). Reply first so the toast can render,
                    // then hand off to a detached helper script that waits for
                    // this process to exit before deleting anything — this
                    // process can't delete its own running exe/dll files.
                    Reply(requestId, new { ok = true });
                    await System.Threading.Tasks.Task.Delay(300);
                    StartUninstallHelperAndExit();
                    break;
                }
                default:
                    Reply(requestId, new { ok = false, error = "unknown command" });
                    break;
            }
        }
        catch (Exception ex)
        {
            LogBridge($"EXCEPTION type={typeForLog} requestId={requestId}: {ex}");
            Reply(requestId, new { ok = false, error = ex.Message });
        }
    }

    /// <summary>
    /// Writes a small PowerShell helper to %TEMP%, launches it detached, then
    /// exits this app. The helper waits for our process to fully release its
    /// files, deletes the app folder (the exe's own directory), the desktop
    /// shortcut, the two %LOCALAPPDATA% marker files, and everything under
    /// the data folder EXCEPT the Reports subfolder (so PDF reports the user
    /// already generated survive), then deletes itself.
    /// </summary>
    private void StartUninstallHelperAndExit()
    {
        var appDir = AppContext.BaseDirectory.TrimEnd('\\');
        var dataDir = _dataDir;
        var desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var shortcutPath = Path.Combine(desktopDir, "Guest Voice Studio.lnk");
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var locatorPath = Path.Combine(localAppData, "GuestVoiceStudio.location");
        var stableIconPath = Path.Combine(localAppData, "GuestVoiceStudio.ico");
        // Both the legacy (pre-v2.2) and current shortcut-consent marker
        // filenames — harmless to remove whichever exists.
        var markerPaths = new[]
        {
            Path.Combine(localAppData, "GuestVoiceStudio.shortcut-created"),
            Path.Combine(localAppData, "GuestVoiceStudio.shortcut-prompted-v2"),
        };
        var scriptPath = Path.Combine(Path.GetTempPath(), $"gvs_uninstall_{Guid.NewGuid():N}.ps1");

        var script = $$"""
            $ErrorActionPreference = 'SilentlyContinue'
            try { Wait-Process -Id {{Environment.ProcessId}} -Timeout 30 } catch {}
            Start-Sleep -Seconds 1
            $shortcut = '{{EscapePs(shortcutPath)}}'
            if ($shortcut -and (Test-Path $shortcut)) { Remove-Item $shortcut -Force }
            $dataDir = '{{EscapePs(dataDir)}}'
            if ($dataDir -and (Test-Path $dataDir)) {
              Get-ChildItem -LiteralPath $dataDir -Force | Where-Object { $_.Name -ne 'Reports' } | Remove-Item -Recurse -Force
            }
            $locator = '{{EscapePs(locatorPath)}}'
            if ($locator -and (Test-Path $locator)) { Remove-Item $locator -Force }
            $stableIcon = '{{EscapePs(stableIconPath)}}'
            if ($stableIcon -and (Test-Path $stableIcon)) { Remove-Item $stableIcon -Force }
            foreach ($marker in @('{{EscapePs(markerPaths[0])}}', '{{EscapePs(markerPaths[1])}}')) {
              if ($marker -and (Test-Path $marker)) { Remove-Item $marker -Force }
            }
            $appDir = '{{EscapePs(appDir)}}'
            if ($appDir -and (Test-Path $appDir)) { Remove-Item -LiteralPath $appDir -Recurse -Force }
            Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force
            """;
        File.WriteAllText(scriptPath, script);

        Process.Start(new ProcessStartInfo("powershell.exe",
            $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"")
        {
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });

        Application.Current.Shutdown();
    }

    /// <summary>
    /// Writes a small PowerShell helper that waits for this process to exit,
    /// robocopy /MOVE's the entire data folder to newDir (this also removes
    /// the now-empty old folder), rewrites the locator file to point at the
    /// new location, relaunches the app, then deletes itself.
    /// </summary>
    private void StartRelocateHelperAndExit(string newDir)
    {
        var oldDir = _dataDir.TrimEnd('\\');
        newDir = newDir.TrimEnd('\\');
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var locatorPath = Path.Combine(localAppData, "GuestVoiceStudio.location");
        var exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "GuestVoiceStudio.exe");
        var scriptPath = Path.Combine(Path.GetTempPath(), $"gvs_relocate_{Guid.NewGuid():N}.ps1");

        var script = $$"""
            $ErrorActionPreference = 'SilentlyContinue'
            try { Wait-Process -Id {{Environment.ProcessId}} -Timeout 30 } catch {}
            Start-Sleep -Seconds 1
            $src = '{{EscapePs(oldDir)}}'
            $dst = '{{EscapePs(newDir)}}'
            New-Item -ItemType Directory -Path $dst -Force | Out-Null
            robocopy $src $dst /E /MOVE /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
            Set-Content -LiteralPath '{{EscapePs(locatorPath)}}' -Value $dst -NoNewline -Encoding UTF8
            Start-Process -FilePath '{{EscapePs(exePath)}}'
            Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force
            """;
        File.WriteAllText(scriptPath, script);

        Process.Start(new ProcessStartInfo("powershell.exe",
            $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"")
        {
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });

        Application.Current.Shutdown();
    }

    private static string EscapePs(string value) => value.Replace("'", "''");

    private void Reply(string? requestId, object payload)
    {
        if (requestId == null) return;
        var wrapped = new Dictionary<string, object?> { ["requestId"] = requestId };
        foreach (var prop in payload.GetType().GetProperties())
            wrapped[prop.Name] = prop.GetValue(payload);
        var json = JsonSerializer.Serialize(wrapped);
        LogBridge($"reply requestId={requestId}: {json}");
        Browser.CoreWebView2.PostWebMessageAsJson(json);
    }
}
