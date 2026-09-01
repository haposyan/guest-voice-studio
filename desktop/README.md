# Guest Voice Studio — ローカル版（Windowsデスクトップアプリ）

`customer_voice_requirements_local_v2.docx`（第2版）に基づく実装です。**Webアプリ版（`../`
以下）はv2で廃止された旧仕様**であり、このフォルダが現行の実装です。第2版の変更点は
ドキュメント本文の「14. 第2版の変更点」を参照してください（要約：サーバー廃止／
1拠点専用のローカル起動／管理者権限不要／Outlook連携をEML中心に変更／本部機能廃止／
ワードクラウードの3色分け追加）。

## これは何か

- Windows 10/11 で動く**ローカル起動のデスクトップアプリ**（`.exe` を実行するだけ）。
- Webサーバー・インターネット接続は不要。**管理者権限も一切不要**（インストール・起動・
  更新・アンインストールのすべて）。
- 中身は前段で作った Web 版（HTML/CSS/JS）をほぼそのまま流用し、
  [WebView2](https://learn.microsoft.com/microsoft-edge/webview2/)（Windowsに標準搭載の
  Chromiumエンジン）で表示する薄いシェル（WPF/C#）でラップしています。UIロジックの
  大部分はブラウザでも単体テストできる状態を保っています。

## ビルド方法

.NET 8 SDK が必要です（管理者権限不要でユーザー領域にインストール可能）。

```powershell
# .NET SDK が無い場合（ユーザー領域にインストール、管理者権限不要）
Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile dotnet-install.ps1
./dotnet-install.ps1 -Channel 8.0 -InstallDir "$env:LOCALAPPDATA\dotnet-sdk" -NoPath

# WebView2 Fixed Version ランタイムを同梱する（初回のみ・約650MB・数分かかります）
# これを行わないと、WebView2が未導入のPCで「WebView2ランタイムの初期化に失敗しました」
# というエラーで起動できません（Windows 11でも100%内蔵とは限りません）。
./scripts/fetch_webview2_runtime.ps1
# 出力: desktop\webview2runtime\（.gitignore対象。ビルド時にexeの隣へ自動コピーされる）

# ビルド（デバッグ実行）
& "$env:LOCALAPPDATA\dotnet-sdk\dotnet.exe" build

# 配布用ビルド（自己完結。.NETランタイムのインストール不要で配布できる）
& "$env:LOCALAPPDATA\dotnet-sdk\dotnet.exe" publish -c Release -r win-x64
# 出力: desktop\bin\Release\net8.0-windows\win-x64\publish\ 一式（約800MB）
```

`publish\` フォルダ一式（`GuestVoiceStudio.exe` と `webapp\`、`webview2runtime\`）をまとめて
配布します。**`GuestVoiceStudio.exe` 単体をコピーしても動きません**（`webapp\` と
`webview2runtime\` が同じ場所に必要です）。フォルダごとZIPにする、またはそのままコピーして
配布してください。WebView2ランタイムを同梱しているため、配布先PCでの追加インストールは
一切不要です（拠点PCへの正式なインストーラー配布は §14 の運用方針どおり、休暇村協会側の
配布プロセスを想定。この試作ではフォルダ一式の配布まで用意しています。要確認事項参照）。

## 動かしてみる

1. `GuestVoiceStudio.exe` を実行（初回起動時にデスクトップへショートカットが自動作成されます。2回目以降はそちらから起動できます）
2. **初回のみ**：データの保存先を確認するダイアログが出ます（既定は
   `%LOCALAPPDATA%\GuestVoiceStudio`）。そのままでよければ「はい」、変更したい場合は
   「いいえ」を選ぶとフォルダ選択画面が開きます
3. 起動画面：休暇村を一覧から選択（一般財団法人休暇村協会の公式サイト掲載の35施設。
   一覧にない場合は「その他」から手入力可）
4. ログイン画面はありません。そのままダッシュボードが開きます
5. 左メニュー「Import｜CSV取込」→ サンプルCSVを取り込む
   - `desktop/scripts/generate_local_sample.ps1` で単一拠点用サンプルCSVを生成できます
     （`webapp/data/sample_local.csv` に出力済み）
   - メールアドレス・氏名・電話番号などの列は自動検出され、取り込まれません
6. Guest Voice / Compare / Action Board / Report Studio を試す

## データの保存先

**初回起動時に選んだ場所**（既定は `%LOCALAPPDATA%\GuestVoiceStudio\`。Windowsの一般
ユーザー領域で管理者権限不要）。どこを選んだかは `%LOCALAPPDATA%\GuestVoiceStudio.location`
というテキストファイル（固定位置）に記録されます。

- `WebView2Data\` — WebView2のプロファイル。アプリの全データ（回答、改善課題、設定等）は
  ブラウザの localStorage としてこの中に保存されます。
- `Reports\` — Report Studioで生成したPDF/EMLの既定の保存先。
- `Backups\` — （将来のデフォルト保存先。現状はSettings画面の保存ダイアログで都度選択）

Settings ＞ ブランド・保存設定 ＞「エクスプローラーで開く」でこのフォルダを直接開けます。
保存先を後から変更するには、フォルダを新しい場所へ移動したうえで
`GuestVoiceStudio.location` の中身を書き換えてください（次回起動時から反映）。

## アーキテクチャ

```
desktop/
  GuestVoiceStudio.csproj   .NET 8 / WPF プロジェクト
  app.manifest              requestedExecutionLevel=asInvoker を明示（無管理者権限の保証）
  MainWindow.xaml(.cs)      WebView2ホスト + ネイティブブリッジ（7コマンドのみ）
  webapp/                   Web版から移植したUI本体（そのままEdge/Chromeでも動作確認可能）
```

### ネイティブブリッジ（`webapp/js/native.js` ⇄ `MainWindow.xaml.cs`）

`window.chrome.webview.postMessage` 経由の JSON リクエスト/レスポンスのみ。7コマンドに
絞ることで、Web版のロジックをほぼ無改造で流用できるようにしています。

| コマンド | 用途 |
|---|---|
| `printToPdf` | `CoreWebView2.PrintToPdfAsync` によるネイティブPDF出力（印刷ダイアログ不要） |
| `readFileBytes` / `writeFileBytes` | ローカルファイルの読み書き（Base64経由） |
| `pickSaveFile` / `pickOpenFile` | ネイティブのファイル保存/選択ダイアログ |
| `openPath` | 既定のアプリでファイルを開く |
| `revealInExplorer` | エクスプローラーでフォルダを開く |

`js/native.js` は `window.__NATIVE__`（デスクトップシェルが起動時に注入）の有無で
自動的にブラウザフォールバックへ切り替わるため、**`webapp/` フォルダは単体でも
（`../scripts/serve.ps1` 等で）ブラウザ上で動作確認できます**。実際、この試作の大半の
画面はまずブラウザ上で検証してからデスクトップシェルに統合しました。

### PDF出力の実装方針（v2要件との対応）

- **MAIL-02 / PDF添付**：`CoreWebView2.PrintToPdfAsync` でヘッドレスに実PDFファイルを
  生成します（ブラウザの印刷ダイアログに依存しない、Web版からの明確な改善点）。
  生成したPDFは、利用者が自身のメールソフトで手動で添付して送信する運用です。

**Outlook連携（MAIL-04/05）は v2.6 で廃止しました**：.emlファイルのファイル関連付け
（openPathで開く）、Outlookクラシックの `/m /a` コマンドライン起動、Outlook COM
自動化（CreateItem + Display()）の3方式を実機フィードバックのたびに順番に試しましたが、
どれもテスト環境で確実には動作しませんでした。これ以上の自動連携は見送り、PDF生成まで
を提供する方針としています（`webapp/js/eml.js` および関連コードは削除済み）。

## v2で削除された機能（Web版から見た差分）

- 本部権限・全拠点集約・拠点間比較（Compare画面は「期間比較」のみ、拠点別ではなく
  「項目別比較」に変更）
- Microsoft 365認証
- サーバー同期（暗号化バックアップのエクスポート/インポートに置き換え。
  Settings＞バックアップ、AES-256-GCM、Web Crypto API使用）

## v2.1での変更点（実機フィードバック反映）

実機で試用した結果をもとに、以下を対応しました。

- **ローカル権限（役割）選択を廃止**：1台のPCを少人数で使う運用では役割の違いが
  分かりにくいとのフィードバックを受け、ログイン画面自体を削除しました。監査ログの
  「誰が」は、代わりにサインイン中のWindowsアカウント名を自動的に使用します。
- **初回の拠点選択を一覧方式に変更**：一般財団法人休暇村協会公式サイト
  （https://www.qkamura.or.jp/list/）掲載の全35施設から選ぶ方式にしました
  （一覧にない場合は手入力も可能）。
- **データ保存先を初回起動時に選択可能に**：WebView2の初期化前（ネイティブ側）で
  保存先フォルダを確認・変更できるようにしました。
- **CSV内の個人情報列を自動検出して除外**：列名に「メール」「氏名」「電話」等が
  含まれる列は取り込まず、CSV原本を保存する設定の場合もマスクして保存します
  （`webapp/js/csv.js` の `isPersonalDataColumn`）。
- **デスクトップショートカットを初回起動時に自動作成**。
- **起動画面に正式ロゴとタグラインを追加**：休暇村協会よりいただいた正式ロゴ画像
  （`desktop/Assets/logo.png`）を表示し、その下に「声を重ねて、ときめく旅の景色へ。」
  というタグラインを添えました。

## 既知の制限（正直に明記）

- **WebView2ランタイムは同梱済み（Fixed Version）**：配布先PCへの追加インストールは
  不要です。実機テストで「WebView2ランタイムの初期化に失敗しました（0x80070003）」が
  発生したため、システム側のランタイムに依存しない構成に変更しました
  （`desktop/scripts/fetch_webview2_runtime.ps1` で取得し、`webview2runtime\` として
  exeと同じフォルダに配布します）。そのぶん配布サイズは約800MBになります。
- **形態素解析なし**：Web版と同様、簡易な語抽出ロジックです（`webapp/js/tokenizer.js`）。
- **署名済みインストーラーは未作成**：単一exeの配布までを用意しています。休暇村協会側で
  コード署名・インストーラー化（MSIX等）を行う場合は別途検討が必要です。
- **この開発環境ではGUIの目視確認ができません**：起動画面・初回設定ダイアログ・
  デスクトップショートカット作成・WebView2初期化まではWin32 API操作による自動テストで
  動作確認していますが、実際の見た目や操作感は実機での確認をお願いします。
- **起動画面のロゴは正式素材に差し替え済みです**：休暇村協会よりいただいたロゴ画像を
  `desktop/Assets/logo.png`（白背景を透過処理したPNG）として組み込んでいます。
  素材が更新される場合は同ファイルを差し替えてください。
