param(
  [Parameter(Mandatory=$true)][string]$Action,
  [string]$Arg = '',
  [string]$Asar = 'D:\DEEPSEEK\resources\app.asar'
)

$ErrorActionPreference = 'Stop'

function Read-Index([string]$path) {
  $fs = [System.IO.File]::OpenRead($path)
  try {
    $head = New-Object byte[] 16
    [void]$fs.Read($head, 0, 16)
    $headerSize = [BitConverter]::ToUInt32($head, 12)
    $buf = New-Object byte[] 0
    $total = 0
    $chunk = New-Object byte[] 1048576
    while ($total -lt $headerSize) {
      $want = [Math]::Min($chunk.Length, $headerSize - $total)
      $n = $fs.Read($chunk, 0, $want)
      if ($n -le 0) { break }
      if ($total -eq 0) { $buf = New-Object byte[] $headerSize }
      [Array]::Copy($chunk, 0, $buf, $total, $n)
      $total += $n
    }
    $json = [System.Text.Encoding]::UTF8.GetString($buf, 0, $total)
    return @{ Index = ($json | ConvertFrom-Json); DataStart = (16 + $headerSize) }
  } finally { $fs.Dispose() }
}

$loaded = Read-Index $Asar

if ($Action -eq 'list') {
  $out = New-Object System.Collections.Generic.List[string]
  function Walk($node, $prefix) {
    foreach ($p in $node.files.PSObject.Properties) {
      $name = $p.Name
      $child = $p.Value
      $full = if ($prefix -eq '') { $name } else { "$prefix/$name" }
      if ($null -ne $child.files) { Walk $child $full }
      else { $script:out.Add(("{0}`t{1}" -f $full, $child.size)) }
    }
  }
  Walk $loaded.Index ''
  $pattern = $Arg
  $out | Where-Object { $pattern -eq '' -or $_ -match $pattern }
}
elseif ($Action -eq 'get') {
  $node = $loaded.Index
  foreach ($seg in ($Arg -split '/')) {
    if ([string]::IsNullOrEmpty($seg)) { continue }
    $node = $node.files.$seg
    if ($null -eq $node) { throw "not found: $Arg" }
  }
  if ($null -ne $node.files) { throw "is a directory: $Arg" }
  $fs = [System.IO.File]::OpenRead($Asar)
  try {
    $fs.Position = $loaded.DataStart + [int64]$node.offset
    $buf = New-Object byte[] ([int64]$node.size)
    $read = 0
    while ($read -lt $buf.Length) {
      $n = $fs.Read($buf, $read, $buf.Length - $read)
      if ($n -le 0) { break }
      $read += $n
    }
    $stream = [System.IO.MemoryStream]::new($buf, 0, $read)
    $reader = New-Object System.IO.StreamReader($stream)
    $reader.ReadToEnd()
  } finally { $fs.Dispose() }
}
elseif ($Action -eq 'save') {
  $node = $loaded.Index
  foreach ($seg in ($Arg -split '/')) {
    if ([string]::IsNullOrEmpty($seg)) { continue }
    $node = $node.files.$seg
    if ($null -eq $node) { throw "not found: $Arg" }
  }
  $fs = [System.IO.File]::OpenRead($Asar)
  try {
    $fs.Position = $loaded.DataStart + [int64]$node.offset
    $buf = New-Object byte[] ([int64]$node.size)
    $read = 0
    while ($read -lt $buf.Length) {
      $n = $fs.Read($buf, $read, $buf.Length - $read)
      if ($n -le 0) { break }
      $read += $n
    }
    [System.IO.File]::WriteAllBytes('D:\Temp\x.bin', $buf)
    "saved $read bytes"
  } finally { $fs.Dispose() }
}
else { throw "unknown action: $Action" }
