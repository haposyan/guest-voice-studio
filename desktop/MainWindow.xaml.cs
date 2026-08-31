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
    private string _dataDir = "";
    // Startup splash must stay up at least this long — the app loads so fast
    // on modern hardware that it used to flash and disappear before the user
    // could read the logo/tagline. (v1: 1s — real-machine feedback said even
    // that read as "too fast"; bumped to 3s.)
    private static readonly TimeSpan MinSplashDuration = TimeSpan.FromSeconds(3);
    private readonly Stopwatch _splashStopwatch = Stopwatch.StartNew();
    private DispatcherTimer? _zoomIndicatorTimer;
    private DispatcherTimer? _zoomPollTimer;
    private double _lastKnownZoomFactor = 1.0;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            CreateDesktopShortcutIfMissing(this);
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
        Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "appassets.local", webAppDir, CoreWebView2HostResourceAccessKind.Allow);

        var nativeContext = JsonSerializer.Serialize(new
        {
            isDesktop = true,
            dataDir = _dataDir,
            reportsDir = Path.Combine(_dataDir, "Reports"),
            backupsDir = Path.Combine(_dataDir, "Backups"),
            appVersion = "1.0.0-local",
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
            LoadingOverlay.Visibility = Visibility.Collapsed;
        };

        Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        Browser.CoreWebView2.Settings.AreDevToolsEnabled = true; // left on to support field troubleshooting

        // Ctrl+マウスホイール／Ctrl+ +/- でのズーム操作に対して、現在の倍率(%)を
        // 右下に数秒間だけ表示する（何%か分からない、という実機フィードバック対応）。
        // WPF WebView2の ZoomFactorChanged イベントはCtrl+ホイールでのユーザー
        // 操作では発火しないことがあるため、ZoomFactor を短間隔でポーリングして
        // 変化を検知する（多少の遅延は数秒表示という要件上まったく問題にならない）。
        _lastKnownZoomFactor = Browser.ZoomFactor;
        _zoomPollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        _zoomPollTimer.Tick += (_, _) =>
        {
            var current = Browser.ZoomFactor;
            if (Math.Abs(current - _lastKnownZoomFactor) < 0.001) return;
            _lastKnownZoomFactor = current;
            ShowZoomIndicator(current);
        };
        _zoomPollTimer.Start();

        Browser.CoreWebView2.Navigate("https://appassets.local/index.html");
    }

    private void ShowZoomIndicator(double zoomFactor)
    {
        var percent = (int)Math.Round(zoomFactor * 100);
        ZoomIndicatorText.Text = $"{percent}%";
        ZoomIndicator.Visibility = Visibility.Visible;
        ZoomIndicator.Opacity = 1;

        _zoomIndicatorTimer?.Stop();
        _zoomIndicatorTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _zoomIndicatorTimer.Tick += (_, _) =>
        {
            _zoomIndicatorTimer!.Stop();
            ZoomIndicator.Opacity = 0;
            ZoomIndicator.Visibility = Visibility.Collapsed;
        };
        _zoomIndicatorTimer.Start();
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
    /// Asks (once, on first launch of this version's consent flow) whether to
    /// create a Desktop shortcut to this exe, then creates it if the user
    /// leaves the pre-checked checkbox checked. Idempotent — does nothing
    /// once already asked, even if the user later deletes the shortcut
    /// (treated as an intentional choice) or declined.
    ///
    /// Uses a NEW marker filename (.shortcut-prompted-v2, not the old
    /// .shortcut-created) deliberately: v2.1's shortcut feature created that
    /// old marker unconditionally on first run, before this consent dialog
    /// existed, so every install upgrading from v2.1 already had it and the
    /// dialog would otherwise never appear even once.
    /// </summary>
    private static void CreateDesktopShortcutIfMissing(Window owner)
    {
        try
        {
            var desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktopDir, "Guest Voice Studio.lnk");
            var markerPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GuestVoiceStudio.shortcut-prompted-v2");
            if (File.Exists(markerPath)) return;

            File.WriteAllText(markerPath, DateTime.Now.ToString("O"));
            if (!ShowShortcutConsentDialog(owner)) return;

            var exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "GuestVoiceStudio.exe");

            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = exePath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(exePath);
            shortcut.IconLocation = exePath + ",0";
            shortcut.Description = "お客様の声・改善管理（Guest Voice Studio）";
            shortcut.Save();
        }
        catch
        {
            // Best-effort only — a missing shortcut is not fatal, the exe still works directly.
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

    private async void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string? requestId = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
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
                case "openMailDraft":
                {
                    // Preferred path: launch Outlook (classic) directly via
                    // its registered exe with /m (mailto-style subject/body)
                    // and /a (attach a real file) — this sidesteps whatever
                    // app (if any) is actually registered as the .eml
                    // handler, which real-machine testing showed is often
                    // nothing, or not Outlook, even when Outlook is
                    // installed and the user's usual mail client.
                    // Fallback: open the pre-built .eml via file association
                    // (works for "new Outlook", Windows Mail, etc.).
                    var subject = root.TryGetProperty("subject", out var sEl) ? sEl.GetString() ?? "" : "";
                    var body = root.TryGetProperty("body", out var bEl) ? bEl.GetString() ?? "" : "";
                    var attachmentPath = root.TryGetProperty("attachmentPath", out var aEl) ? aEl.GetString() : null;
                    var emlPath = root.TryGetProperty("emlPath", out var eEl) ? eEl.GetString() : null;

                    var outlookExe = FindOutlookClassicExePath();
                    if (outlookExe != null)
                    {
                        try
                        {
                            var mailto = "mailto:?subject=" + Uri.EscapeDataString(subject) + "&body=" + Uri.EscapeDataString(body);
                            var args = $"/m \"{mailto}\"";
                            if (!string.IsNullOrWhiteSpace(attachmentPath) && File.Exists(attachmentPath))
                                args += $" /a \"{attachmentPath}\"";
                            Process.Start(new ProcessStartInfo(outlookExe, args) { UseShellExecute = true });
                            Reply(requestId, new { ok = true, method = "outlook-classic" });
                            break;
                        }
                        catch
                        {
                            // fall through to the .eml fallback below
                        }
                    }

                    if (!string.IsNullOrWhiteSpace(emlPath) && File.Exists(emlPath))
                    {
                        try
                        {
                            Process.Start(new ProcessStartInfo(emlPath) { UseShellExecute = true });
                            Reply(requestId, new { ok = true, method = "eml-association" });
                        }
                        catch (Exception ex)
                        {
                            Reply(requestId, new { ok = false, error = "no-mail-app: " + ex.Message });
                        }
                    }
                    else
                    {
                        Reply(requestId, new { ok = false, error = "outlook-not-found-and-no-eml" });
                    }
                    break;
                }
                case "revealInExplorer":
                {
                    var path = root.GetProperty("path").GetString();
                    if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
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
                    var result = dlg.ShowDialog(this);
                    Reply(requestId, new { ok = result == true, path = result == true ? dlg.FileName : null });
                    break;
                }
                case "pickOpenFile":
                {
                    var filter = root.TryGetProperty("filter", out var f) ? f.GetString() : "All files (*.*)|*.*";
                    var dlg = new OpenFileDialog { Filter = filter };
                    var result = dlg.ShowDialog(this);
                    Reply(requestId, new { ok = result == true, path = result == true ? dlg.FileName : null });
                    break;
                }
                case "pickFolder":
                {
                    var title = root.TryGetProperty("title", out var tEl) ? tEl.GetString() : "フォルダを選択してください";
                    var dlg = new OpenFolderDialog { Title = title, Multiselect = false };
                    var result = dlg.ShowDialog(this);
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
                case "printToPdf":
                {
                    var path = root.GetProperty("path").GetString()!;
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    var success = await Browser.CoreWebView2.PrintToPdfAsync(path);
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
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    await File.WriteAllBytesAsync(path, Convert.FromBase64String(base64));
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

    /// <summary>
    /// Locates Outlook (classic desktop) via the standard App Paths registry
    /// key that OUTLOOK.EXE's installer registers — the same mechanism
    /// Windows' own "Run" dialog uses to resolve "outlook". Returns null if
    /// Outlook classic isn't installed (e.g. "new Outlook"-only machines),
    /// in which case the caller falls back to opening an .eml by file
    /// association.
    /// </summary>
    private static string? FindOutlookClassicExePath()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE");
            var path = key?.GetValue(null) as string;
            return !string.IsNullOrWhiteSpace(path) && File.Exists(path) ? path : null;
        }
        catch
        {
            return null;
        }
    }

    private void Reply(string? requestId, object payload)
    {
        if (requestId == null) return;
        var wrapped = new Dictionary<string, object?> { ["requestId"] = requestId };
        foreach (var prop in payload.GetType().GetProperties())
            wrapped[prop.Name] = prop.GetValue(payload);
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(wrapped));
    }
}
