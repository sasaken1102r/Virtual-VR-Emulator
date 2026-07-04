# 言語別のsteamvr-view合成とデモGIF録画を行う
# 実行前提: tauri dev+SteamVR起動中、ダッシュボードは vrcmd --hidedashboard で非表示にしておく
$sp = Join-Path $env:TEMP "vvre-shoot"
New-Item -ItemType Directory -Force $sp | Out-Null
$tools = $PSScriptRoot
$img = Join-Path (Split-Path $tools) "images"
$rec = Join-Path $tools ".rec"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinRec6 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public static IntPtr found = IntPtr.Zero;
    public static string target = "";
}
"@

[WinRec6]::target = "VRビュー"
$cb = { param($h, $l) $t = New-Object System.Text.StringBuilder 256; [WinRec6]::GetWindowText($h, $t, 256) | Out-Null; if ($t.ToString() -eq [WinRec6]::target -and [WinRec6]::IsWindowVisible($h)) { [WinRec6]::found = $h; return $false }; return $true }
[WinRec6]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$vrH = [WinRec6]::found
if ($vrH -eq [IntPtr]::Zero) { Write-Output "VRビュー not found"; exit 1 }
$r = New-Object WinRec6+RECT
[WinRec6]::GetWindowRect($vrH, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top

function Cap-VR([string]$path) {
    $bmp = New-Object System.Drawing.Bitmap($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [WinRec6]::PrintWindow($vrH, $hdc, 2) | Out-Null
    $g.ReleaseHdc($hdc)
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# ヒーローポーズのVRビューを1枚(合成用)
node "$tools\demo_motion.mjs" pose
Start-Sleep 2
Cap-VR "$sp\vr_hero.png"

# 言語ごとにsteamvr-view合成
$vr = [System.Drawing.Image]::FromFile("$sp\vr_hero.png")
foreach ($lang in 'ja','en','zh','ko') {
    $app = [System.Drawing.Image]::FromFile("$img\$lang\main.png")
    $hh = 720
    $appW = [int]($app.Width * $hh / $app.Height)
    $vrW = [int]($vr.Width * $hh / $vr.Height)
    $total = New-Object System.Drawing.Bitmap(($appW + $vrW + 12), $hh)
    $g = [System.Drawing.Graphics]::FromImage($total)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::FromArgb(22,22,30))
    $g.DrawImage($app, 0, 0, $appW, $hh)
    $g.DrawImage($vr, $appW + 12, 0, $vrW, $hh)
    $g.Dispose()
    $total.Save("$img\$lang\steamvr-view.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $app.Dispose()
    $total.Dispose()
}
$vr.Dispose()
Write-Output "composites done"

# 言語ごとにGIF録画
foreach ($lang in 'ja','en','zh','ko') {
    if (Test-Path $rec) { cmd /c "rmdir /s /q `"$rec`"" }
    if (Test-Path "$sp\demo_vr") { cmd /c "rmdir /s /q `"$sp\demo_vr`"" }
    New-Item -ItemType Directory -Force "$sp\demo_vr" | Out-Null

    $p = Start-Process node -ArgumentList "`"$tools\record_app.mjs`"","$lang" -NoNewWindow -PassThru
    Start-Sleep 3
    $frames = 0
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 15) {
        Cap-VR ("$sp\demo_vr\f{0:D4}.png" -f $frames)
        $frames++
    }
    $sw.Stop()
    Wait-Process -Id $p.Id -Timeout 30 -ErrorAction SilentlyContinue

    $fps = [math]::Round($frames / 15, 2)
    $webm = (Get-ChildItem "$rec\*.webm" | Select-Object -First 1).FullName
    ffmpeg -y -ss 3 -t 11 -i "$webm" -framerate $fps -i "$sp\demo_vr\f%04d.png" -filter_complex "[0:v]fps=8,scale=-2:380[a];[1:v]fps=8,scale=-2:380,trim=duration=11[b];[a][b]hstack=inputs=2,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" "$img\$lang\demo.gif" 2>$null
    Write-Output "$lang gif: $([math]::Round((Get-Item "$img\$lang\demo.gif").Length / 1MB, 1)) MB ($frames vr frames)"
}
Write-Output "all done"
