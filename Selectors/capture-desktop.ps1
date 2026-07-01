param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

[void][System.Reflection.Assembly]::LoadWithPartialName("System.Runtime.WindowsRuntime")
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

function Get-ProcessSafe {
  param([int]$ProcessId)

  try {
    return Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-ProcessNameSafe {
  param([int]$ProcessId)

  $process = Get-ProcessSafe -ProcessId $ProcessId

  if ($null -eq $process) {
    return $null
  }

  return $process.ProcessName
}

function Get-ExecutablePathSafe {
  param([int]$ProcessId)

  $process = Get-ProcessSafe -ProcessId $ProcessId

  if ($null -eq $process) {
    return $null
  }

  try {
    return $process.Path
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
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
    } |
    Select-Object -First 1

  $genericMethod = $method.MakeGenericMethod($ResultType)
  $task = $genericMethod.Invoke($null, @($Operation))
  $task.Wait()

  return $task.Result
}

function Get-ControlTypeName {
  param([System.Windows.Automation.AutomationElement]$Element)

  try {
    $programmaticName = $Element.Current.ControlType.ProgrammaticName
  } catch {
    return $null
  }

  if ([string]::IsNullOrWhiteSpace($programmaticName)) {
    return $null
  }

  if ($programmaticName -match "\.(?<name>[^.]+)$") {
    return $matches["name"]
  }

  return $programmaticName
}

function Matches-Target {
  param(
    [string]$Candidate,
    [string]$Desired
  )

  if ([string]::IsNullOrWhiteSpace($Desired)) {
    return $false
  }

  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    return $false
  }

  return $Candidate.ToLowerInvariant().Contains($Desired.ToLowerInvariant())
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

function Get-WindowRectSafe {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

  try {
    $rect = $WindowElement.Current.BoundingRectangle

    $left = [int][Math]::Max(0, [Math]::Floor($rect.Left))
    $top = [int][Math]::Max(0, [Math]::Floor($rect.Top))
    $width = [int][Math]::Max(0, [Math]::Ceiling($rect.Width))
    $height = [int][Math]::Max(0, [Math]::Ceiling($rect.Height))
  } catch {
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
          idx          = $null
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
          idx          = $null
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
  } catch {
    return @()
  } finally {
    Remove-Item -LiteralPath $tempPath -ErrorAction SilentlyContinue
  }
}

function Get-UiaRuntimeIdText {
  param([System.Windows.Automation.AutomationElement]$Element)

  if ($null -eq $Element) {
    return $null
  }

  try {
    $runtimeId = $Element.GetRuntimeId()

    if ($null -eq $runtimeId) {
      return $null
    }

    return [string]::Join(".", $runtimeId)
  } catch {
    return $null
  }
}

function Get-UiaSiblingIndex {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationElement]$Parent
  )

  if ($null -eq $Element -or $null -eq $Parent) {
    return 1
  }

  try {
    $children = $Parent.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $targetRuntimeId = Get-UiaRuntimeIdText -Element $Element
    $targetClassName = Normalize-Value $Element.Current.ClassName
    $targetControlType = Normalize-Value (Get-ControlTypeName -Element $Element)

    $idx = 0

    for ($i = 0; $i -lt $children.Count; $i++) {
      $child = $children.Item($i)

      $childClassName = Normalize-Value $child.Current.ClassName
      $childControlType = Normalize-Value (Get-ControlTypeName -Element $child)

      if ($childClassName -eq $targetClassName -and $childControlType -eq $targetControlType) {
        $idx += 1
      }

      $childRuntimeId = Get-UiaRuntimeIdText -Element $child

      if ($targetRuntimeId -and $childRuntimeId -and $childRuntimeId -eq $targetRuntimeId) {
        if ($idx -le 0) {
          return 1
        }

        return $idx
      }
    }

    return 1
  } catch {
    return 1
  }
}

function Get-UiaCtrlId {
  param([System.Windows.Automation.AutomationElement]$Element)

  if ($null -eq $Element) {
    return $null
  }

  try {
    $automationId = Normalize-Value $Element.Current.AutomationId

    # In Win32 SAP Logon controls, AutomationId is usually the native control id.
    # Example: Filter Items = 1091, Log On = 1068.
    if (-not [string]::IsNullOrWhiteSpace($automationId) -and $automationId -match "^\d{1,6}$") {
      return $automationId
    }

    return $null
  } catch {
    return $null
  }
}

function Build-UiaCandidate {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

  try {
    $parent = $walker.GetParent($Element)
  } catch {
    $parent = $null
  }

  $processName = Get-ProcessNameSafe -ProcessId $Element.Current.ProcessId
$controlType = Normalize-Value (Get-ControlTypeName -Element $Element)
$idx = Get-UiaSiblingIndex -Element $Element -Parent $parent
$ctrlId = Get-UiaCtrlId -Element $Element

  return [pscustomobject]@{
    processId    = $Element.Current.ProcessId
    processName  = Normalize-Value $processName
    automationId = Normalize-Value $Element.Current.AutomationId
    ctrlId       = $ctrlId
    name         = Normalize-Value $Element.Current.Name
    className    = Normalize-Value $Element.Current.ClassName
    controlType  = $controlType
    idx          = $idx
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
}

function Get-GenericDesktopCandidates {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

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
    "Text",
    "DataGrid",
    "DataItem",
    "Pane"
  )

  $candidates = @()
  $warnings = @()

  try {
    $allDescendants = $WindowElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    for ($index = 0; $index -lt $allDescendants.Count; $index++) {
      $element = $allDescendants.Item($index)
      $controlType = Get-ControlTypeName -Element $element

      if ($supportedTypes -notcontains $controlType) {
        continue
      }

      $candidate = Build-UiaCandidate -Element $element -WindowElement $WindowElement

      if ($candidate.isOffscreen) {
        continue
      }

      if ([string]::IsNullOrWhiteSpace($candidate.name) -and [string]::IsNullOrWhiteSpace($candidate.automationId)) {
        continue
      }

      $candidates += $candidate
    }
  } catch {
    $warnings += "UIAutomation enumeration failed; OCR fallback will be used."
  }

  $ocrCandidates = Get-OcrCandidates -WindowElement $WindowElement

  if ($ocrCandidates.Count -gt 0) {
    $warnings += "OCR fallback candidates were added for desktop text anchoring."
    $candidates += $ocrCandidates
  }

  if ($candidates.Count -eq 0) {
    $warnings += "Desktop capture found the window but no visible controls or OCR text were captured."
  }

  return [pscustomobject]@{
    Candidates = $candidates
    Warnings   = $warnings
  }
}

function Get-TargetDescriptor {
  param($InputObject)

  $target = $InputObject.target

  if ($target -is [string]) {
    return [pscustomobject]@{
      windowTitle    = Normalize-Value $target
      processName    = $null
      executablePath = $null
    }
  }

  return [pscustomobject]@{
    windowTitle    = Normalize-Value $target.windowTitle
    processName    = Normalize-Value $target.processName
    executablePath = Normalize-Value $target.executablePath
  }
}

function Get-WindowScore {
  param(
    [string]$ProcessName,
    [string]$Title,
    [string]$ExecutablePath,
    [pscustomobject]$TargetDescriptor
  )

  $score = 0

  if (-not [string]::IsNullOrWhiteSpace($TargetDescriptor.processName)) {
    if ($ProcessName -and $ProcessName.ToLowerInvariant() -eq $TargetDescriptor.processName.ToLowerInvariant()) {
      $score += 100
    } elseif (Matches-Target -Candidate $ProcessName -Desired $TargetDescriptor.processName) {
      $score += 70
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($TargetDescriptor.windowTitle)) {
    if ($Title -and $Title.ToLowerInvariant() -eq $TargetDescriptor.windowTitle.ToLowerInvariant()) {
      $score += 100
    } elseif (Matches-Target -Candidate $Title -Desired $TargetDescriptor.windowTitle) {
      $score += 70
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($TargetDescriptor.executablePath)) {
    if ($ExecutablePath -and $ExecutablePath.ToLowerInvariant() -eq $TargetDescriptor.executablePath.ToLowerInvariant()) {
      $score += 80
    } elseif (Matches-Target -Candidate $ExecutablePath -Desired $TargetDescriptor.executablePath) {
      $score += 50
    }
  }

  return $score
}

$inputObject = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$targetDescriptor = Get-TargetDescriptor -InputObject $inputObject

if (
  [string]::IsNullOrWhiteSpace($targetDescriptor.processName) -and
  [string]::IsNullOrWhiteSpace($targetDescriptor.windowTitle) -and
  [string]::IsNullOrWhiteSpace($targetDescriptor.executablePath)
) {
  throw "Desktop mode target must include processName, windowTitle, or executablePath."
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)

$matchedWindows = @()

for ($index = 0; $index -lt $windows.Count; $index++) {
  $window = $windows.Item($index)

  $processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $window.Current.ProcessId)
  $title = Normalize-Value $window.Current.Name
  $className = Normalize-Value $window.Current.ClassName
  $executablePath = Normalize-Value (Get-ExecutablePathSafe -ProcessId $window.Current.ProcessId)

  $processMatch = Matches-Target -Candidate $processName -Desired $targetDescriptor.processName
  $titleMatch = Matches-Target -Candidate $title -Desired $targetDescriptor.windowTitle
  $pathMatch = Matches-Target -Candidate $executablePath -Desired $targetDescriptor.executablePath

  if (-not ($processMatch -or $titleMatch -or $pathMatch)) {
    continue
  }

  $score = Get-WindowScore `
    -ProcessName $processName `
    -Title $title `
    -ExecutablePath $executablePath `
    -TargetDescriptor $targetDescriptor

  $matchedWindows += [pscustomobject]@{
    Score          = $score
    Window         = $window
    ProcessName    = $processName
    Title          = $title
    ClassName      = $className
    ExecutablePath = $executablePath
  }
}

if ($matchedWindows.Count -eq 0) {
  throw "No desktop application window matched the requested target."
}

$selectedWindow = $matchedWindows |
  Sort-Object Score -Descending |
  Select-Object -First 1

$windowElement = $selectedWindow.Window

Ensure-WindowVisible -WindowElement $windowElement

$capture = Get-GenericDesktopCandidates -WindowElement $windowElement

$output = [ordered]@{
  targetWindow = [ordered]@{
    title       = Normalize-Value $windowElement.Current.Name
    className   = Normalize-Value $windowElement.Current.ClassName
    processId   = $windowElement.Current.ProcessId
    processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $windowElement.Current.ProcessId)
    kind        = "desktop_generic"
  }
  targetKind = "desktop_generic"
  warnings   = $capture.Warnings
  candidates = $capture.Candidates
}

$output | ConvertTo-Json -Depth 10