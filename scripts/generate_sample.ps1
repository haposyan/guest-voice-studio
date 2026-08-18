# Generates a synthetic customer-voice CSV covering 35 stores x 2 months
# so the prototype has realistic data to import, analyze and compare.
$OutputEncoding = [System.Text.Encoding]::UTF8

$stores = @(
  "札幌店","函館店","盛岡店","仙台店","郡山店","水戸店","宇都宮店","前橋店","さいたま店","千葉店",
  "新宿店","渋谷店","横浜店","川崎店","新潟店","富山店","金沢店","福井店","甲府店","長野店",
  "岐阜店","静岡店","名古屋店","津店","大津店","京都店","大阪店","神戸店","奈良店","和歌山店",
  "岡山店","広島店","高松店","松山店","福岡店"
)

# item key => [ratingColumnHeader, commentColumnHeader]
$items = @(
  @{ key="接客対応"; rate="接客対応_評価"; cmt="接客対応_コメント" },
  @{ key="清潔さ";   rate="清潔さ_評価";   cmt="清潔さ_コメント" },
  @{ key="設備";     rate="設備_評価";     cmt="設備_コメント" },
  @{ key="対応スピード"; rate="対応スピード_評価"; cmt="対応スピード_コメント" },
  @{ key="総合満足度"; rate="総合満足度_評価"; cmt="総合満足度_コメント" }
)

$posComments = @{
  "接客対応"=@("スタッフの対応がとても丁寧でした","笑顔で挨拶していただき気持ちよかったです","質問にすぐ答えてくれて助かりました")
  "清潔さ"=@("店内がとても清潔で気持ちよかったです","清掃が行き届いていました")
  "設備"=@("設備が新しく快適でした","駐車場が広くて停めやすかったです")
  "対応スピード"=@("待ち時間が少なくスムーズでした","案内が早くて助かりました")
  "総合満足度"=@("また利用したいと思います","家族にもすすめたいです","期待以上のサービスでした")
}
$negComments = @{
  "接客対応"=@("スタッフの対応が冷たく感じました","挨拶がなく残念でした","説明が分かりにくかったです","態度が悪いスタッフがいました")
  "清潔さ"=@("トイレの清掃が行き届いていませんでした","床が汚れているのが気になりました","匂いが気になりました")
  "設備"=@("空調の効きが悪かったです","設備が古く感じました","駐車場が狭くて停めにくかったです")
  "対応スピード"=@("待ち時間が長く感じました","呼んでもなかなか来てもらえませんでした","対応が遅く感じました")
  "総合満足度"=@("価格の割に満足度が低いと感じました","次は利用しないかもしれません","期待外れでした")
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

function Get-Weighted-Rating($storeBias) {
  # storeBias -2..+2 shifts distribution; base weights skew positive
  $r = Get-Random -Minimum 1 -Maximum 101
  $threshold = 20 - ($storeBias * 6)
  if ($threshold -lt 2) { $threshold = 2 }
  if ($r -le $threshold) { return (Get-Random -Minimum 1 -Maximum 3) }       # low 1-2
  elseif ($r -le $threshold + 15) { return 3 }                               # mid
  else { return (Get-Random -Minimum 4 -Maximum 6) }                         # high 4-5
}

$rows = New-Object System.Collections.Generic.List[string]
$header = @("回答ID","回答日","拠点名") + ($items | ForEach-Object { @($_.rate, $_.cmt) } | ForEach-Object { $_ })
$rows.Add(($header -join ","))

$today = Get-Date -Year 2026 -Month 8 -Day 18
$startCur = Get-Date -Year 2026 -Month 8 -Day 1
$startPrev = Get-Date -Year 2026 -Month 7 -Day 1
$endPrev = Get-Date -Year 2026 -Month 7 -Day 31

$id = 1
$rand = New-Object System.Random

foreach ($store in $stores) {
  $storeBias = Get-Random -Minimum -2 -Maximum 3
  foreach ($periodStart in @($startPrev, $startCur)) {
    $periodEnd = if ($periodStart -eq $startPrev) { $endPrev } else { $today }
    $dayCount = ($periodEnd - $periodStart).Days + 1
    $responseCount = Get-Random -Minimum 8 -Maximum 18
    for ($i = 0; $i -lt $responseCount; $i++) {
      $offset = Get-Random -Minimum 0 -Maximum $dayCount
      $date = $periodStart.AddDays($offset).ToString("yyyy-MM-dd")
      $cells = @("R$($id.ToString('00000'))", $date, $store)
      foreach ($item in $items) {
        $hasRating = (Get-Random -Minimum 1 -Maximum 101) -le 96
        $hasComment = (Get-Random -Minimum 1 -Maximum 101) -le 40
        if ($hasRating) {
          $rating = Get-Weighted-Rating $storeBias
          $cells += $rating
        } else {
          $cells += ""
          $rating = 3
        }
        if ($hasComment) {
          $c = Get-Rand-Comment $item.key $rating
        } else {
          $c = ""
        }
        if ($c -match ",") { $c = '"' + $c + '"' }
        $cells += $c
      }
      $rows.Add(($cells -join ","))
      $id++
    }
  }
}

# add a few intentional duplicate response IDs to exercise dedupe logic
$dupLine = $rows[5]
$rows.Add($dupLine)
$rows.Add($rows[12])

$outPath = Join-Path $PSScriptRoot "..\data\sample_35stores.csv"
[System.IO.File]::WriteAllLines($outPath, $rows, (New-Object System.Text.UTF8Encoding($true)))
Write-Output "Wrote $($rows.Count - 1) data rows to $outPath"
