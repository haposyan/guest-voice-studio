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
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            LoadingOverlay.Visibility = Visibility.Visible;
            MessageBox.Show(
                "WebView2 ランタイムの初期化に失敗しました。\n" +
                "Windows 11 には標準搭載されていますが、Windows 10 では Evergreen ランタイムの導入が必要な場合があります。\n\n" +
                "詳細: " + ex.Message,
                "起動エラー", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appRoot = Path.Combine(localAppData, "GuestVoiceStudio");
        _dataDir = appRoot;
        Directory.CreateDirectory(appRoot);
        Directory.CreateDirectory(Path.Combine(appRoot, "Reports"));
        Directory.CreateDirectory(Path.Combine(appRoot, "Backups"));
        var webViewUserData = Path.Combine(appRoot, "WebView2Data");
        Directory.CreateDirectory(webViewUserData);

        var env = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewUserData);
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
