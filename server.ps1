# خادم محلي بسيط لتشغيل اللعبة مع صور البطاقات على http://localhost:8765
param([int]$Port = 8765, [switch]$Open)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "One Piece Card Game: http://localhost:$Port  (Ctrl+C to stop)"
if ($Open) { Start-Process "http://localhost:$Port/" }
$types = @{ '.html'='text/html; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.js'='text/javascript'; '.css'='text/css'; '.webmanifest'='application/manifest+json'; '.json'='application/json' }
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', $(if ($ext -eq '.jpg' -or $ext -eq '.png') { 'max-age=86400' } else { 'no-cache' }))
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
  } catch {} finally { $ctx.Response.Close() }
}
