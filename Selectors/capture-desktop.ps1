param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class SelectorNativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Normalize-Value {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  $text = $text -replace "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", " "
  $text = $text -replace "\s+", " "
  $text = $text.Trim()

  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  return $text
}

function Get-ProcessNameSafe {
  param([int]$ProcessId)

  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName
  } catch {
    return $null
  }
}

function Await-AsyncOp {
  param(
    [Parameter(Mandatory = $true)]
    $Operation,
    [Parameter(Mandatory = $true)]
    [Type]$ResultType
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } |
    Select-Object -First 1

  $genericMethod = $method.MakeGenericMethod($ResultType)
  $task = $genericMethod.Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Get-ControlTypeName {
  param([System.Windows.Automation.AutomationElement]$Element)

  $programmaticName = $Element.Current.ControlType.ProgrammaticName
  if ([string]::IsNullOrWhiteSpace($programmaticName)) {
    return $null
  }

  if ($programmaticName -match "\.(?<name>[^.]+)$") {
    return $matches["name"]
  }

  return $programmaticName
}

function Ensure-WindowVisible {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

  $hwnd = $WindowElement.Current.NativeWindowHandle
  if ($hwnd -le 0) {
    return
  }

  [void][SelectorNativeMethods]::ShowWindow([IntPtr]::new($hwnd), 9)
  Start-Sleep -Milliseconds 300
  [void][SelectorNativeMethods]::SetForegroundWindow([IntPtr]::new($hwnd))
  Start-Sleep -Milliseconds 500
}

function Matches-Target {
  param(
    [string]$Candidate,
    [string]$Desired
  )

  if ([string]::IsNullOrWhiteSpace($Desired)) {
    return $true
  }

  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    return $false
  }

  return $Candidate.ToLowerInvariant().Contains($Desired.ToLowerInvariant())
}

function Build-Candidate {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = $walker.GetParent($Element)
  $processName = Get-ProcessNameSafe -ProcessId $Element.Current.ProcessId

  $candidate = [ordered]@{
    processId    = $Element.Current.ProcessId
    processName  = Normalize-Value $processName
    automationId = Normalize-Value $Element.Current.AutomationId
    name         = Normalize-Value $Element.Current.Name
    className    = Normalize-Value $Element.Current.ClassName
    controlType  = Normalize-Value (Get-ControlTypeName -Element $Element)
    frameworkId  = Normalize-Value $Element.Current.FrameworkId
    helpText     = Normalize-Value $Element.Current.HelpText
    accessKey    = Normalize-Value $Element.Current.AccessKey
    isEnabled    = [bool]$Element.Current.IsEnabled
    isOffscreen  = [bool]$Element.Current.IsOffscreen
    parent       = if ($null -ne $parent) {
      [ordered]@{
        name         = Normalize-Value $parent.Current.Name
        automationId = Normalize-Value $parent.Current.AutomationId
        className    = Normalize-Value $parent.Current.ClassName
        controlType  = Normalize-Value (Get-ControlTypeName -Element $parent)
      }
    } else {
      $null
    }
    window       = [ordered]@{
      title       = Normalize-Value $WindowElement.Current.Name
      className   = Normalize-Value $WindowElement.Current.ClassName
      processId   = $WindowElement.Current.ProcessId
      processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
    }
    captureKind  = "uia"
    boundingRect = [ordered]@{
      left   = [int]$Element.Current.BoundingRectangle.Left
      top    = [int]$Element.Current.BoundingRectangle.Top
      width  = [int]$Element.Current.BoundingRectangle.Width
      height = [int]$Element.Current.BoundingRectangle.Height
    }
  }

  return [pscustomobject]$candidate
}

function Get-WindowRectSafe {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

  $rect = $WindowElement.Current.BoundingRectangle
  $hasInvalidUiRect = $false
  $values = @($rect.Left, $rect.Top, $rect.Width, $rect.Height)
  foreach ($value in $values) {
    if ([double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) {
      $hasInvalidUiRect = $true
      break
    }
  }

  if (-not $hasInvalidUiRect) {
    $left = [int][Math]::Max(0, [Math]::Floor($rect.Left))
    $top = [int][Math]::Max(0, [Math]::Floor($rect.Top))
    $width = [int][Math]::Max(0, [Math]::Ceiling($rect.Width))
    $height = [int][Math]::Max(0, [Math]::Ceiling($rect.Height))
  } else {
    $left = 0
    $top = 0
    $width = 0
    $height = 0
  }

  if ($width -le 0 -or $height -le 0) {
    $hwnd = $WindowElement.Current.NativeWindowHandle
    if ($hwnd -le 0) {
      return $null
    }

    $nativeRect = New-Object SelectorNativeMethods+RECT
    $ok = [SelectorNativeMethods]::GetWindowRect([IntPtr]::new($hwnd), [ref]$nativeRect)
    if (-not $ok) {
      return $null
    }

    $left = [int][Math]::Max(0, $nativeRect.Left)
    $top = [int][Math]::Max(0, $nativeRect.Top)
    $width = [int][Math]::Max(0, $nativeRect.Right - $nativeRect.Left)
    $height = [int][Math]::Max(0, $nativeRect.Bottom - $nativeRect.Top)
  }

  if ($width -le 0 -or $height -le 0) {
    return $null
  }

  return [pscustomobject]@{
    Left   = $left
    Top    = $top
    Width  = $width
    Height = $height
  }
}

function Get-OcrCandidates {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

  $windowRect = Get-WindowRectSafe -WindowElement $WindowElement
  if ($null -eq $windowRect) {
    return @()
  }

  $tempPath = Join-Path $env:TEMP ("selector-ocr-" + [guid]::NewGuid().ToString("N") + ".png")
  $bitmap = New-Object System.Drawing.Bitmap $windowRect.Width, $windowRect.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.CopyFromScreen(
      (New-Object System.Drawing.Point($windowRect.Left, $windowRect.Top)),
      [System.Drawing.Point]::Empty,
      (New-Object System.Drawing.Size($windowRect.Width, $windowRect.Height))
    )
    $bitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  try {
    $file = Await-AsyncOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tempPath)) ([Windows.Storage.StorageFile])
    $stream = Await-AsyncOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-AsyncOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-AsyncOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

    if ($null -eq $engine) {
      return @()
    }

    $ocrResult = Await-AsyncOp ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
    $windowProcessName = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
    $windowTitle = Normalize-Value $WindowElement.Current.Name
    $windowClass = Normalize-Value $WindowElement.Current.ClassName

    $ocrCandidates = @()

    foreach ($line in $ocrResult.Lines) {
      $lineText = Normalize-Value $line.Text
      $lineWidth = [int]$line.BoundingRect.Width
      $lineHeight = [int]$line.BoundingRect.Height
      if ($lineText -and $lineWidth -gt 0 -and $lineHeight -gt 0) {
        $ocrCandidates += [pscustomobject]@{
          processId    = $WindowElement.Current.ProcessId
          processName  = $windowProcessName
          automationId = $null
          name         = $lineText
          className    = "OCRLine"
          controlType  = "Text"
          frameworkId  = "OCR"
          helpText     = $null
          accessKey    = $null
          isEnabled    = $true
          isOffscreen  = $false
          parent       = $null
          window       = [ordered]@{
            title       = $windowTitle
            className   = $windowClass
            processId   = $WindowElement.Current.ProcessId
            processName = $windowProcessName
          }
          captureKind  = "ocr_line"
          boundingRect = [ordered]@{
            left   = $windowRect.Left + [int]$line.BoundingRect.X
            top    = $windowRect.Top + [int]$line.BoundingRect.Y
            width  = $lineWidth
            height = $lineHeight
          }
        }
      }

      foreach ($word in $line.Words) {
        $wordText = Normalize-Value $word.Text
        if (-not $wordText) {
          continue
        }

        $ocrCandidates += [pscustomobject]@{
          processId    = $WindowElement.Current.ProcessId
          processName  = $windowProcessName
          automationId = $null
          name         = $wordText
          className    = "OCRWord"
          controlType  = "Text"
          frameworkId  = "OCR"
          helpText     = $null
          accessKey    = $null
          isEnabled    = $true
          isOffscreen  = $false
          parent       = $null
          window       = [ordered]@{
            title       = $windowTitle
            className   = $windowClass
            processId   = $WindowElement.Current.ProcessId
            processName = $windowProcessName
          }
          captureKind  = "ocr_word"
          boundingRect = [ordered]@{
            left   = $windowRect.Left + [int]$word.BoundingRect.X
            top    = $windowRect.Top + [int]$word.BoundingRect.Y
            width  = [int]$word.BoundingRect.Width
            height = [int]$word.BoundingRect.Height
          }
        }
      }
    }

    return $ocrCandidates
  } finally {
    Remove-Item -LiteralPath $tempPath -ErrorAction SilentlyContinue
  }
}

$input = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$target = $input.target

if ($target -is [string]) {
  $targetDescriptor = [pscustomobject]@{
    windowTitle = $target
    processName = $null
  }
} else {
  $targetDescriptor = $target
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$matchedWindows = @()

for ($index = 0; $index -lt $windows.Count; $index++) {
  $window = $windows.Item($index)
  $processName = Get-ProcessNameSafe -ProcessId $window.Current.ProcessId
  $title = Normalize-Value $window.Current.Name

  if (-not (Matches-Target -Candidate $processName -Desired $targetDescriptor.processName)) {
    continue
  }

  if (-not (Matches-Target -Candidate $title -Desired $targetDescriptor.windowTitle)) {
    continue
  }

  $score = 0
  if (-not [string]::IsNullOrWhiteSpace($targetDescriptor.processName) -and $processName -eq $targetDescriptor.processName) {
    $score += 50
  } elseif (-not [string]::IsNullOrWhiteSpace($targetDescriptor.processName) -and $processName) {
    $score += 20
  }

  if (-not [string]::IsNullOrWhiteSpace($targetDescriptor.windowTitle) -and $title -eq $targetDescriptor.windowTitle) {
    $score += 50
  } elseif (-not [string]::IsNullOrWhiteSpace($targetDescriptor.windowTitle) -and $title) {
    $score += 20
  }

  $matchedWindows += [pscustomobject]@{
    Score       = $score
    Window      = $window
    ProcessName = Normalize-Value $processName
    Title       = $title
  }
}

if ($matchedWindows.Count -eq 0) {
  throw "No desktop application window matched the requested target."
}

$selectedWindow = $matchedWindows | Sort-Object Score -Descending | Select-Object -First 1
$windowElement = $selectedWindow.Window
Ensure-WindowVisible -WindowElement $windowElement
$allDescendants = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$supportedTypes = @(
  "Edit",
  "Button",
  "ComboBox",
  "Hyperlink",
  "Document",
  "CheckBox",
  "RadioButton",
  "ListItem",
  "MenuItem",
  "TabItem",
  "Text"
)

$candidates = @()

for ($index = 0; $index -lt $allDescendants.Count; $index++) {
  $element = $allDescendants.Item($index)
  $controlType = Get-ControlTypeName -Element $element

  if ($supportedTypes -notcontains $controlType) {
    continue
  }

  $candidate = Build-Candidate -Element $element -WindowElement $windowElement

  if ($candidate.isOffscreen) {
    continue
  }

  if ([string]::IsNullOrWhiteSpace($candidate.name) -and [string]::IsNullOrWhiteSpace($candidate.automationId)) {
    continue
  }

  $candidates += $candidate
}

$warnings = @()
if ($candidates.Count -eq 0) {
  $warnings += "Desktop capture found the window but no visible actionable controls with stable metadata."
}

$ocrCandidates = Get-OcrCandidates -WindowElement $windowElement
if ($ocrCandidates.Count -gt 0) {
  $warnings += "OCR fallback candidates were added for desktop text anchoring."
  $candidates += $ocrCandidates
}

$output = [ordered]@{
  targetWindow = [ordered]@{
    title       = Normalize-Value $windowElement.Current.Name
    className   = Normalize-Value $windowElement.Current.ClassName
    processId   = $windowElement.Current.ProcessId
    processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $windowElement.Current.ProcessId)
  }
  warnings     = $warnings
  candidates   = $candidates
}

$output | ConvertTo-Json -Depth 8
