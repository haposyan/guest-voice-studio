using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
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

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            CreateDesktopShortcutIfMissing();
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
        Browser.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess) LoadingOverlay.Visibility = Visibility.Collapsed;
        };

        Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        Browser.CoreWebView2.Settings.AreDevToolsEnabled = true; // left on to support field troubleshooting

        Browser.CoreWebView2.Navigate("https://appassets.local/index.html");
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
    /// Creates a Desktop shortcut to this exe on first launch, so the user
    /// doesn't have to keep navigating to wherever the exe was unzipped.
    /// Idempotent — does nothing once the shortcut already exists (even if
    /// the user later deletes it, which is treated as an intentional choice).
    /// </summary>
    private static void CreateDesktopShortcutIfMissing()
    {
        try
        {
            var desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktopDir, "Guest Voice Studio.lnk");
            var markerPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "GuestVoiceStudio.shortcut-created");
            if (File.Exists(markerPath)) return;

            var exePath = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "GuestVoiceStudio.exe");

            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
            var shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = exePath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(exePath);
            shortcut.IconLocation = exePath + ",0";
            shortcut.Description = "お客様の声・改善管理（Guest Voice Studio）";
            shortcut.Save();

            File.WriteAllText(markerPath, DateTime.Now.ToString("O"));
        }
        catch
        {
            // Best-effort only — a missing shortcut is not fatal, the exe still works directly.
        }
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
                    var path = root.GetProperty("path").GetString();
                    if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                    Reply(requestId, new { ok = true });
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
                    var dlg = new SaveFileDialog { FileName = suggestedName, Filter = filter };
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

    private void Reply(string? requestId, object payload)
    {
        if (requestId == null) return;
        var wrapped = new Dictionary<string, object?> { ["requestId"] = requestId };
        foreach (var prop in payload.GetType().GetProperties())
            wrapped[prop.Name] = prop.GetValue(payload);
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(wrapped));
    }
}
