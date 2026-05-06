param()

$srcRoot = 'C:\Fin\Grit_Strategy_Lab'
$dstRoot = 'C:\Fin\Grit_Strategy_Lab2'

$worklist = @(
    @{
        Name = 'GSL_UI_V1_PLAN.md'
        Source = Join-Path $srcRoot 'RECOVER_UI_V1_PLAN.md'
        Dest = Join-Path $dstRoot 'GSL_UI_V1_PLAN.md'
    }
    @{
        Name = 'GSL_TEC_V1_PLAN.md'
        Source = Join-Path $srcRoot 'RECOVER_TEC_V1_PLAN.md'
        Dest = Join-Path $dstRoot 'GSL_TEC_V1_PLAN.md'
    }
)

foreach ($item in $worklist) {
    if (-not (Test-Path -LiteralPath $item.Source)) {
        Write-Output ("[SKIP] 源文件不存在: {0}" -f $item.Source)
        continue
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($item.Source)
        [System.IO.File]::WriteAllBytes($item.Dest, $bytes)
        Write-Output ("[OK] 已覆盖: {0}" -f $item.Dest)
    }
    catch {
        Write-Output ("[ERR] 覆盖失败: {0} -> {1}" -f $item.Source, $item.Dest)
        Write-Output ("      $($_.Exception.Message)")
    }
}

Write-Output ""
Write-Output "说明：CEO/DESIGN 两个文件当前在 Grit_Strategy_Lab2 的 Git blob 均为损坏对象（`inflate` 解压失败），并且已知历史备份也为全0字节。当前环境无法直接写入 C:\Fin\Grit_Strategy_Lab2，建议继续在有该目录权限的会话执行。"

