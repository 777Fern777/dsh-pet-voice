param([string]$Text, [string]$WavOut)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$syn.SetOutputToWaveFile($WavOut, $fmt)
$zh = $syn.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
if ($zh) { $syn.SelectVoice($zh.VoiceInfo.Name) }
$syn.Speak($Text)
$syn.Dispose()
Write-Output "tts-done voice=$($zh.VoiceInfo.Name)"
