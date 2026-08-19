# Generates a synthetic single-store CSV (2 months) for the v2 local desktop
# app, matching the store name a user would type during first-run setup.
param(
  [string]$StoreName = "砂丘 休暇村"
)
$OutputEncoding = [System.Text.Encoding]::UTF8

$items = @(
  @{ key="接客対応"; rate="接客対応_評価"; cmt="接客対応_コメント" },
  @{ key="清潔さ";   rate="清潔さ_評価";   cmt="清潔さ_コメント" },
  @{ key="設備";     rate="設備_評価";     cmt="設備_コメント" },
  @{ key="対応スピード"; rate="対応スピード_評価"; cmt="対応スピード_コメント" },
  @{ key="総合満足度"; rate="総合満足度_評価"; cmt="総合満足度_コメント" }
)

$posComments = @{
  "接客対応"=@("スタッフの対応がとても丁寧でした","笑顔で挨拶していただき気持ちよかったです","質問にすぐ答えてくれて助かりました")
  "清潔さ"=@("館内がとても清潔で気持ちよかったです","清掃が行き届いていました")
  "設備"=@("温泉がとても良かったです","部屋が新しく快適でした","駐車場が広くて停めやすかったです")
  "対応スピード"=@("チェックインがスムーズでした","案内が早くて助かりました")
  "総合満足度"=@("また利用したいと思います","家族にもすすめたいです","期待以上のサービスでした")
}
$negComments = @{
  "接客対応"=@("スタッフの対応が冷たく感じました","挨拶がなく残念でした","説明が分かりにくかったです")
  "清潔さ"=@("大浴場の清掃が行き届いていませんでした","床が汚れているのが気になりました")
  "設備"=@("空調の効きが悪かったです","設備が古く感じました","Wi-Fiが繋がりにくかったです")
  "対応スピード"=@("チェックインの待ち時間が長く感じました","食事の提供が遅く感じました")
  "総合満足度"=@("価格の割に満足度が低いと感じました","次は利用しないかもしれません")
}
$neuComments = @{
  "接客対応"=@("普通の対応でした","特に問題はありませんでした")
  "清潔さ"=@("清潔さは普通でした")
  "設備"=@("設備は必要十分でした")
  "対応スピード"=@("待ち時間は許容範囲でした")
  "総合満足度"=@("可もなく不可もなくという印象です")
}

function Get-Rand-Comment($itemKey, $rating) {
  if ($rating -le 2) { $pool = $negComments[$itemKey] }
  elseif ($rating -eq 3) { $pool = $neuComments[$itemKey] }
  else { $pool = $posComments[$itemKey] }
  return $pool | Get-Random
}
function Get-Weighted-Rating() {
  $r = Get-Random -Minimum 1 -Maximum 101
  if ($r -le 16) { return (Get-Random -Minimum 1 -Maximum 3) }
  elseif ($r -le 32) { return 3 }
  else { return (Get-Random -Minimum 4 -Maximum 6) }
}

$rows = New-Object System.Collections.Generic.List[string]
$header = @("回答ID","回答日","拠点名") + ($items | ForEach-Object { @($_.rate, $_.cmt) } | ForEach-Object { $_ })
$rows.Add(($header -join ","))

$startPrev = Get-Date -Year 2026 -Month 7 -Day 1
$endPrev = Get-Date -Year 2026 -Month 7 -Day 31
$startCur = Get-Date -Year 2026 -Month 8 -Day 1
$today = Get-Date -Year 2026 -Month 8 -Day 19

$id = 1
foreach ($periodStart in @($startPrev, $startCur)) {
  $periodEnd = if ($periodStart -eq $startPrev) { $endPrev } else { $today }
  $dayCount = ($periodEnd - $periodStart).Days + 1
  $responseCount = Get-Random -Minimum 45 -Maximum 65
  for ($i = 0; $i -lt $responseCount; $i++) {
    $offset = Get-Random -Minimum 0 -Maximum $dayCount
    $date = $periodStart.AddDays($offset).ToString("yyyy-MM-dd")
    $cells = @("R$($id.ToString('00000'))", $date, $StoreName)
    foreach ($item in $items) {
      $hasRating = (Get-Random -Minimum 1 -Maximum 101) -le 96
      $hasComment = (Get-Random -Minimum 1 -Maximum 101) -le 42
      if ($hasRating) { $rating = Get-Weighted-Rating; $cells += $rating } else { $cells += ""; $rating = 3 }
      if ($hasComment) { $c = Get-Rand-Comment $item.key $rating } else { $c = "" }
      if ($c -match ",") { $c = '"' + $c + '"' }
      $cells += $c
    }
    $rows.Add(($cells -join ","))
    $id++
  }
}

$dupLine = $rows[7]
$rows.Add($dupLine)

$outPath = Join-Path $PSScriptRoot "..\webapp\data\sample_local.csv"
[System.IO.File]::WriteAllLines($outPath, $rows, (New-Object System.Text.UTF8Encoding($true)))
Write-Output "Wrote $($rows.Count - 1) data rows to $outPath"
