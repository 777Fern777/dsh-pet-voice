param(
  [Parameter(Mandatory=$true)][string]$OutPath,
  [string]$Text = "今天天气不错，我们一起出去玩吧。",
  [string]$Voice = "Microsoft Huihui Desktop"
)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($Voice)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($OutPath, $fmt)
$s.Speak($Text)
$s.Dispose()
Write-Output ("OK " + $OutPath)
