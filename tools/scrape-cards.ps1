# يجلب بيانات كل البطاقات من الموقع الرسمي ويكتبها في cards-data.js
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$base = 'https://en.onepiece-cardgame.com/cardlist/'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web
function Get-Html($url) { (Invoke-WebRequest -UseBasicParsing -Uri $url -UserAgent 'Mozilla/5.0' -TimeoutSec 60).Content }
function Clean($s) {
  if ($null -eq $s) { return '' }
  $s = $s -replace '<br\s*/?>', ' ' -replace '<[^>]+>', ''
  $s = [System.Web.HttpUtility]::HtmlDecode($s)
  return ($s -replace '\s+', ' ').Trim()
}
function Field($block, $cls) {
  $m = [regex]::Match($block, '<div class="' + $cls + '">(.*?)</div>', 'Singleline')
  if (-not $m.Success) { return '' }
  return Clean ($m.Groups[1].Value -replace '<h3>.*?</h3>', '')
}
$first = Get-Html ($base + '?series=569101')
$sel = [regex]::Match($first, '<select[^>]*name="series"[^>]*>(.*?)</select>', 'Singleline').Groups[1].Value
$series = [regex]::Matches($sel, '<option value="(\d+)"[^>]*>(.*?)</option>', 'Singleline') | ForEach-Object { @{ id = $_.Groups[1].Value; name = (Clean $_.Groups[2].Value) } }
"series: $($series.Count)"
$cards = [ordered]@{}
foreach ($s in $series) {
  $html = Get-Html ($base + '?series=' + $s.id)
  $blocks = [regex]::Matches($html, '<dl class="modalCol" id="([^"]+)">(.*?)</dl>', 'Singleline')
  foreach ($b in $blocks) {
    $id = $b.Groups[1].Value
    if ($id -like '*_p*' -or $cards.Contains($id)) { continue }
    $blk = $b.Groups[2].Value
    $info = [regex]::Matches(([regex]::Match($blk, '<div class="infoCol">(.*?)</div>', 'Singleline').Groups[1].Value), '<span>(.*?)</span>') | ForEach-Object { Clean $_.Groups[1].Value }
    $costBlk = [regex]::Match($blk, '<div class="cost"><h3>(.*?)</h3>(.*?)</div>', 'Singleline')
    $attr = [regex]::Match($blk, '<div class="attribute">.*?<i>(.*?)</i>', 'Singleline').Groups[1].Value
    $setInfo = Field $blk 'getInfo'
    $setCode = [regex]::Match($setInfo, '\[([A-Z0-9\-]+)\]').Groups[1].Value
    if (-not $setCode) { $setCode = $s.name }
    $cards[$id] = [ordered]@{
      id = $id; r = $info[1]; t = $info[2]
      n = Clean ([regex]::Match($blk, '<div class="cardName">(.*?)</div>', 'Singleline').Groups[1].Value)
      c = Clean $costBlk.Groups[2].Value
      p = Field $blk 'power'; k = Field $blk 'counter'; col = Field $blk 'color'
      f = Field $blk 'feature'; x = Field $blk 'text'; tr = Field $blk 'trigger'
      a = Clean $attr; set = $setCode
    }
  }
  "$($s.id) $($s.name): total $($cards.Count)"
}
$json = ($cards.Values | ConvertTo-Json -Depth 3 -Compress)
[IO.File]::WriteAllText((Join-Path $root 'cards-data.js'), "window.CARDS_ALL=$json;", (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $root 'tools\all-ids.txt'), (($cards.Keys) -join "`n"))
"done: $($cards.Count) cards"
