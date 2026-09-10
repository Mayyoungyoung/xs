$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconFolder = Join-Path $PSScriptRoot 'assets'
New-Item -ItemType Directory -Path $iconFolder -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#8b372f'))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = [System.Drawing.Font]::new('Microsoft YaHei', 136, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('墨', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, -2, 256, 256), $format)
$memory = [System.IO.MemoryStream]::new()
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $memory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $iconFolder 'momai.png'), $pngBytes)
$iconStream = [System.IO.File]::Create((Join-Path $iconFolder 'momai.ico'))
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$pngBytes.Length); $writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Dispose(); $memory.Dispose(); $graphics.Dispose(); $font.Dispose(); $bitmap.Dispose(); $format.Dispose()
