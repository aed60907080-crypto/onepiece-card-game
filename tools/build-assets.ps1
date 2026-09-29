# يحوّل صور البطاقات إلى JPEG خفيف للجوال وينشئ أيقونات التطبيق
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cards = Join-Path $root 'cards'
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L
function New-Canvas($w, $h) { $b = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'; $g.TextRenderingHint = 'AntiAliasGridFit'; return @($b, $g) }

# 1) صور البطاقات: PNG 600px -> JPEG 420px
$n = 0
Get-ChildItem $cards -Filter '*.png' | ForEach-Object {
  $out = [IO.Path]::ChangeExtension($_.FullName, '.jpg')
  if (-not (Test-Path $out)) {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    $b, $g = New-Canvas 420 587
    $g.DrawImage($img, 0, 0, 420, 587)
    $b.Save($out, $enc, $params); $g.Dispose(); $b.Dispose(); $img.Dispose(); $n++
  }
}
"converted=$n"

# 2) الأيقونات
$icons = Join-Path $root 'icons'; New-Item -ItemType Directory -Force $icons | Out-Null
function Draw-Icon($size, $path, $pad) {
  $b, $g = New-Canvas $size $size
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255,31,99,148)), ([System.Drawing.Color]::FromArgb(255,5,13,24)), 90
  $g.FillRectangle($bg, $rect)
  $c = [int]($size * (0.5 - $pad)); $cx = $size / 2
  $gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,244,197,66))
  $g.FillEllipse($gold, $cx - $c, $cx - $c, 2 * $c, 2 * $c)
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,179,38,30))
  $r2 = [int]($c * 0.86); $g.FillEllipse($red, $cx - $r2, $cx - $r2, 2 * $r2, 2 * $r2)
  $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $font = New-Object System.Drawing.Font 'Segoe UI Symbol', ([single]($c * 0.95)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString([string][char]0x2620, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, ([single]($size*0.02)), $size, $size), $fmt)
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()
}
Draw-Icon 192 (Join-Path $icons 'icon-192.png') 0.08
Draw-Icon 512 (Join-Path $icons 'icon-512.png') 0.08
Draw-Icon 512 (Join-Path $icons 'maskable-512.png') 0.2
Draw-Icon 180 (Join-Path $icons 'apple-touch-icon.png') 0.06
"icons done"
