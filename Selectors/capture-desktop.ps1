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

function Get-ComPropertyValue {
  param(
    $Object,
    [string]$PropertyName
  )

  if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($PropertyName)) {
    return $null
  }

  try {
    return $Object.$PropertyName
  } catch {
    return $null
  }
}

function Invoke-ComMethodSafe {
  param(
    $Object,
    [string]$MethodName,
    [object[]]$Arguments = @()
  )

  if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($MethodName)) {
    return $null
  }

  try {
    return $Object.PSObject.Methods[$MethodName].Invoke($Arguments)
  } catch {
    try {
      return $Object.$MethodName.Invoke($Arguments)
    } catch {
      return $null
    }
  }
}

function Get-ComCollectionItems {
  param($Collection)

  $items = @()
  if ($null -eq $Collection) {
    return $items
  }

  $count = 0
  try {
    $count = [int]$Collection.Count
  } catch {
    $count = 0
  }

  for ($index = 0; $index -lt $count; $index++) {
    $item = $null
    try {
      $item = $Collection.Item($index)
    } catch {
      try {
        $item = $Collection.ElementAt($index)
      } catch {
        $item = $null
      }
    }

    if ($null -ne $item) {
      $items += $item
    }
  }

  return $items
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

function Build-UiaCandidate {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = $walker.GetParent($Element)
  $processName = Get-ProcessNameSafe -ProcessId $Element.Current.ProcessId

  return [pscustomobject]@{
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
}

function Get-GenericDesktopCandidates {
  param([System.Windows.Automation.AutomationElement]$WindowElement)

  $allDescendants = $WindowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
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
  $warnings = @()

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

  if ($candidates.Count -eq 0) {
    $warnings += "Desktop capture found the window but no visible actionable controls with stable metadata."
  }

  $ocrCandidates = Get-OcrCandidates -WindowElement $WindowElement
  if ($ocrCandidates.Count -gt 0) {
    $warnings += "OCR fallback candidates were added for desktop text anchoring."
    $candidates += $ocrCandidates
  }

  return [pscustomobject]@{
    Candidates = $candidates
    Warnings   = $warnings
  }
}

function Test-IsSapTarget {
  param(
    [pscustomobject]$TargetDescriptor,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  if ($null -ne $TargetDescriptor.sap) {
    return $true
  }

  $processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
  $windowTitle = Normalize-Value $WindowElement.Current.Name
  $windowClass = Normalize-Value $WindowElement.Current.ClassName
  $executablePath = Normalize-Value (Get-ExecutablePathSafe -ProcessId $WindowElement.Current.ProcessId)

  $values = @($processName, $windowTitle, $windowClass, $executablePath) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.ToLowerInvariant() }

  foreach ($value in $values) {
    if ($value -match "\bsap(logon|gui|lgpad)?\b" -or $value -match "sap(gui)?\.exe" -or $value.Contains("sap easy access") -or $value.Contains("sap logon")) {
      return $true
    }
  }

  return $false
}

function Get-SapGuiRoot {
  try {
    return [System.Runtime.InteropServices.Marshal]::GetActiveObject("SAPGUI")
  } catch {
    return $null
  }
}

function Get-SapConnectionLabel {
  param($Connection)

  $values = @(
    (Normalize-Value (Get-ComPropertyValue -Object $Connection -PropertyName "Description")),
    (Normalize-Value (Get-ComPropertyValue -Object $Connection -PropertyName "Name"))
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  if ($values.Count -gt 0) {
    return $values[0]
  }

  return $null
}

function Get-SapWindowTitle {
  param($SapWindow)

  $values = @(
    (Normalize-Value (Get-ComPropertyValue -Object $SapWindow -PropertyName "Text")),
    (Normalize-Value (Get-ComPropertyValue -Object $SapWindow -PropertyName "Name")),
    (Normalize-Value (Get-ComPropertyValue -Object $SapWindow -PropertyName "Caption"))
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  if ($values.Count -gt 0) {
    return $values[0]
  }

  return $null
}

function Get-SapBoundingRect {
  param($Component)

  $left = Get-ComPropertyValue -Object $Component -PropertyName "ScreenLeft"
  $top = Get-ComPropertyValue -Object $Component -PropertyName "ScreenTop"
  $width = Get-ComPropertyValue -Object $Component -PropertyName "Width"
  $height = Get-ComPropertyValue -Object $Component -PropertyName "Height"

  if ($null -eq $left -or $null -eq $top -or $null -eq $width -or $null -eq $height) {
    return $null
  }

  return [ordered]@{
    left   = [int]$left
    top    = [int]$top
    width  = [int]$width
    height = [int]$height
  }
}

function Build-SapSessionSummary {
  param(
    $Connection,
    $Session,
    [int]$SessionIndex
  )

  $info = Get-ComPropertyValue -Object $Session -PropertyName "Info"
  $activeWindow = Get-ComPropertyValue -Object $Session -PropertyName "ActiveWindow"

  return [pscustomobject]@{
    Session       = $Session
    Connection    = $Connection
    SessionIndex  = $SessionIndex
    SessionId     = Normalize-Value (Get-ComPropertyValue -Object $Session -PropertyName "Id")
    ConnectionName = Get-SapConnectionLabel -Connection $Connection
    SystemName    = Normalize-Value (Get-ComPropertyValue -Object $info -PropertyName "SystemName")
    Transaction   = Normalize-Value (Get-ComPropertyValue -Object $info -PropertyName "Transaction")
    WindowTitle   = Get-SapWindowTitle -SapWindow $activeWindow
    WindowId      = Normalize-Value (Get-ComPropertyValue -Object $activeWindow -PropertyName "Id")
  }
}

function Get-SapSessionScore {
  param(
    [pscustomobject]$SessionSummary,
    [pscustomobject]$TargetDescriptor,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  $score = 0
  $sapHints = $TargetDescriptor.sap
  $windowTitle = Normalize-Value $WindowElement.Current.Name

  if ($null -ne $sapHints) {
    if ($null -ne $sapHints.sessionIndex -and $SessionSummary.SessionIndex -eq [int]$sapHints.sessionIndex) {
      $score += 100
    }

    if ((Matches-Target -Candidate $SessionSummary.SystemName -Desired $sapHints.systemName)) {
      $score += 50
    }

    if ((Matches-Target -Candidate $SessionSummary.ConnectionName -Desired $sapHints.connectionName)) {
      $score += 45
    }

    if ((Matches-Target -Candidate $SessionSummary.WindowTitle -Desired $sapHints.windowTitle)) {
      $score += 35
    }
  }

  if ((Matches-Target -Candidate $SessionSummary.WindowTitle -Desired $TargetDescriptor.windowTitle)) {
    $score += 25
  }

  if ((Matches-Target -Candidate $SessionSummary.WindowTitle -Desired $windowTitle)) {
    $score += 20
  }

  if ($score -eq 0 -and -not [string]::IsNullOrWhiteSpace($SessionSummary.WindowTitle)) {
    $score += 5
  }

  return $score
}

function New-SapWindowMetadata {
  param(
    [System.Windows.Automation.AutomationElement]$WindowElement,
    [pscustomobject]$SessionSummary
  )

  return [ordered]@{
    title          = Normalize-Value $WindowElement.Current.Name
    className      = Normalize-Value $WindowElement.Current.ClassName
    processId      = $WindowElement.Current.ProcessId
    processName    = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
    sapWindowTitle = $SessionSummary.WindowTitle
    sapWindowId    = $SessionSummary.WindowId
  }
}

function Add-SapComponentCandidates {
  param(
    $Component,
    [pscustomobject]$SessionSummary,
    [System.Windows.Automation.AutomationElement]$WindowElement,
    [string]$ParentPath,
    [System.Collections.Generic.HashSet[string]]$Visited,
    [ref]$Candidates
  )

  if ($null -eq $Component) {
    return
  }

  $componentPath = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "Id")
  if ([string]::IsNullOrWhiteSpace($componentPath)) {
    return
  }

  if ($Visited.Contains($componentPath)) {
    return
  }

  [void]$Visited.Add($componentPath)

  $componentType = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "Type")
  $technicalName = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "Name")
  $text = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "Text")
  $tooltip = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "Tooltip")
  $defaultTooltip = Normalize-Value (Get-ComPropertyValue -Object $Component -PropertyName "DefaultTooltip")
  $name = if ($text) { $text } elseif ($tooltip) { $tooltip } else { $technicalName }

  $componentId = $componentPath
  if ($componentPath -match "([^/]+)$") {
    $componentId = $matches[1]
  }

  if (-not [string]::IsNullOrWhiteSpace($technicalName) -or -not [string]::IsNullOrWhiteSpace($text) -or -not [string]::IsNullOrWhiteSpace($tooltip)) {
    $candidate = [pscustomobject]@{
      processId      = $WindowElement.Current.ProcessId
      processName    = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
      automationId   = $null
      name           = $name
      text           = $text
      className      = Normalize-Value $WindowElement.Current.ClassName
      controlType    = $componentType
      frameworkId    = "SAP"
      helpText       = $defaultTooltip
      accessKey      = $null
      isEnabled      = $true
      isOffscreen    = $false
      parent         = $null
      window         = New-SapWindowMetadata -WindowElement $WindowElement -SessionSummary $SessionSummary
      captureKind    = "sap"
      boundingRect   = Get-SapBoundingRect -Component $Component
      sessionId      = $SessionSummary.SessionId
      windowId       = $SessionSummary.WindowId
      systemName     = $SessionSummary.SystemName
      connectionName = $SessionSummary.ConnectionName
      transactionCode = $SessionSummary.Transaction
      componentId    = $componentId
      componentPath  = $componentPath
      componentType  = $componentType
      technicalName  = $technicalName
      tooltip        = if ($tooltip) { $tooltip } else { $defaultTooltip }
      parentPath     = $ParentPath
    }

    $Candidates.Value += $candidate
  }

  $children = Get-ComCollectionItems -Collection (Get-ComPropertyValue -Object $Component -PropertyName "Children")
  foreach ($child in $children) {
    Add-SapComponentCandidates -Component $child -SessionSummary $SessionSummary -WindowElement $WindowElement -ParentPath $componentPath -Visited $Visited -Candidates $Candidates
  }
}

function Get-SapCandidates {
  param(
    [System.Windows.Automation.AutomationElement]$WindowElement,
    [pscustomobject]$TargetDescriptor
  )

  $warnings = @()
  $root = Get-SapGuiRoot
  if ($null -eq $root) {
    return [pscustomobject]@{
      Candidates = @()
      Warnings   = @("SAP GUI Scripting not available")
    }
  }

  $engine = Invoke-ComMethodSafe -Object $root -MethodName "GetScriptingEngine"
  if ($null -eq $engine) {
    return [pscustomobject]@{
      Candidates = @()
      Warnings   = @("SAP window detected but scripting is disabled")
    }
  }

  $sessions = @()
  $globalIndex = 0

  foreach ($connection in (Get-ComCollectionItems -Collection (Get-ComPropertyValue -Object $engine -PropertyName "Children"))) {
    foreach ($session in (Get-ComCollectionItems -Collection (Get-ComPropertyValue -Object $connection -PropertyName "Children"))) {
      $sessions += Build-SapSessionSummary -Connection $connection -Session $session -SessionIndex $globalIndex
      $globalIndex += 1
    }
  }

  if ($sessions.Count -eq 0) {
    return [pscustomobject]@{
      Candidates = @()
      Warnings   = @("SAP window detected but scripting is disabled")
    }
  }

  $selectedSession = $sessions |
    Sort-Object @{ Expression = { Get-SapSessionScore -SessionSummary $_ -TargetDescriptor $TargetDescriptor -WindowElement $WindowElement }; Descending = $true } |
    Select-Object -First 1

  if ($null -eq $selectedSession) {
    return [pscustomobject]@{
      Candidates = @()
      Warnings   = @("SAP GUI Scripting not available")
    }
  }

  $candidates = @()
  $visited = New-Object 'System.Collections.Generic.HashSet[string]'
  $windows = Get-ComCollectionItems -Collection (Get-ComPropertyValue -Object $selectedSession.Session -PropertyName "Children")

  foreach ($sapWindow in $windows) {
    Add-SapComponentCandidates -Component $sapWindow -SessionSummary $selectedSession -WindowElement $WindowElement -ParentPath $null -Visited $visited -Candidates ([ref]$candidates)
  }

  if ($candidates.Count -eq 0) {
    $warnings += "Desktop capture found the SAP window but no SAP native controls were enumerated."
  }

  return [pscustomobject]@{
    Candidates = $candidates
    Warnings   = $warnings
  }
}

$input = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$target = $input.target

if ($target -is [string]) {
  $targetDescriptor = [pscustomobject]@{
    windowTitle    = $target
    processName    = $null
    executablePath = $null
    sap            = $null
  }
} else {
  $targetDescriptor = [pscustomobject]@{
    windowTitle    = Normalize-Value $target.windowTitle
    processName    = Normalize-Value $target.processName
    executablePath = Normalize-Value $target.executablePath
    sap            = $target.sap
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$matchedWindows = @()

for ($index = 0; $index -lt $windows.Count; $index++) {
  $window = $windows.Item($index)
  $processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $window.Current.ProcessId)
  $title = Normalize-Value $window.Current.Name
  $className = Normalize-Value $window.Current.ClassName
  $executablePath = Normalize-Value (Get-ExecutablePathSafe -ProcessId $window.Current.ProcessId)

  if (-not (Matches-Target -Candidate $processName -Desired $targetDescriptor.processName)) {
    continue
  }

  if (-not (Matches-Target -Candidate $title -Desired $targetDescriptor.windowTitle)) {
    continue
  }

  if (-not (Matches-Target -Candidate $executablePath -Desired $targetDescriptor.executablePath)) {
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

  if (-not [string]::IsNullOrWhiteSpace($targetDescriptor.executablePath) -and $executablePath -eq $targetDescriptor.executablePath) {
    $score += 40
  } elseif (-not [string]::IsNullOrWhiteSpace($targetDescriptor.executablePath) -and $executablePath) {
    $score += 15
  }

  if ($null -ne $targetDescriptor.sap -and (Test-IsSapTarget -TargetDescriptor $targetDescriptor -WindowElement $window)) {
    $score += 15
  }

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

$selectedWindow = $matchedWindows | Sort-Object Score -Descending | Select-Object -First 1
$windowElement = $selectedWindow.Window
Ensure-WindowVisible -WindowElement $windowElement

$isSapTarget = Test-IsSapTarget -TargetDescriptor $targetDescriptor -WindowElement $windowElement
$targetKind = if ($isSapTarget) { "desktop_sap" } else { "desktop_generic" }

if ($isSapTarget) {
  $capture = Get-SapCandidates -WindowElement $windowElement -TargetDescriptor $targetDescriptor
} else {
  $capture = Get-GenericDesktopCandidates -WindowElement $windowElement
}

$output = [ordered]@{
  targetWindow = [ordered]@{
    title       = Normalize-Value $windowElement.Current.Name
    className   = Normalize-Value $windowElement.Current.ClassName
    processId   = $windowElement.Current.ProcessId
    processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $windowElement.Current.ProcessId)
    kind        = $targetKind
  }
  targetKind   = $targetKind
  warnings     = $capture.Warnings
  candidates   = $capture.Candidates
}

$output | ConvertTo-Json -Depth 10
