using System.Text.RegularExpressions;
using DocumentOcr.Core.Abstractions;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using Tesseract;

namespace DocumentOcr.Infrastructure.Ocr;

/// <summary>
/// Performs OCR recognition by using a local Tesseract engine instance and bundled TessData files.
/// </summary>
/// <remarks>
/// <para>
/// This type borrows the supplied <see cref="DocumentPage"/> and its stream for the duration of each
/// <see cref="RecognizeAsync"/> call. The caller retains ownership of the page and remains responsible for
/// disposing it.
/// </para>
/// <para>
/// Native Tesseract state is cached per engine instance and released when this object is disposed. Access is
/// serialized per instance, and no static or process-wide engine cache is used.
/// </para>
/// </remarks>
public sealed class TesseractOcrEngine : IOcrEngine, IDisposable
{
    private static readonly Regex SupportedLanguageCodePattern = new(
        "^[a-z0-9_]{1,64}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly SemaphoreSlim _engineGate = new(1, 1);
    private readonly string _nativeSearchRoot;

    private TesseractEngine? _engine;
    private string? _engineLanguageExpression;
    private int _disposeSignaled;

    /// <summary>
    /// Initializes a new instance of the <see cref="TesseractOcrEngine"/> class by using the default
    /// assembly-relative <c>TessData</c> directory.
    /// </summary>
    public TesseractOcrEngine()
        : this(tessDataDirectory: null)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="TesseractOcrEngine"/> class.
    /// </summary>
    /// <param name="tessDataDirectory">
    /// An optional trusted operator override for the directory that contains the required
    /// <c>*.traineddata</c> files. When omitted, <c>TessData</c> under the current assembly directory is used.
    /// </param>
    public TesseractOcrEngine(string? tessDataDirectory)
    {
        _nativeSearchRoot = ResolveAssemblyDirectory();
        TessDataDirectory = ResolveTessDataDirectory(tessDataDirectory, _nativeSearchRoot);
    }

    /// <summary>
    /// Gets the canonical directory path that this engine uses to locate Tesseract <c>*.traineddata</c> files.
    /// </summary>
    public string TessDataDirectory { get; }

    /// <inheritdoc />
    public async Task<OcrPageResult> RecognizeAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(documentPage);
        ArgumentNullException.ThrowIfNull(options);

        var normalizedLanguages = NormalizeLanguages(options.Languages);
        var languageExpression = string.Join("+", normalizedLanguages);

        cancellationToken.ThrowIfCancellationRequested();
        ThrowIfDisposed();

        await _engineGate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            ThrowIfDisposed();
            EnsureLanguageDataExists(normalizedLanguages, languageExpression, documentPage.PageNumber);
            EnsureEngineInitialized(languageExpression, documentPage.PageNumber);
            cancellationToken.ThrowIfCancellationRequested();

            var imageBytes = await ReadImageBytesAsync(documentPage.ImageStream, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();

            using var pix = LoadPix(imageBytes, documentPage.PageNumber);
            cancellationToken.ThrowIfCancellationRequested();

            using var page = ProcessPage(pix, documentPage.PageNumber);
            cancellationToken.ThrowIfCancellationRequested();

            var text = NormalizeLineEndings(page.GetText() ?? string.Empty);
            cancellationToken.ThrowIfCancellationRequested();
            var confidence = ConvertConfidence(page.GetMeanConfidence(), documentPage.PageNumber);

            cancellationToken.ThrowIfCancellationRequested();

            return new OcrPageResult(documentPage.PageNumber, text, confidence);
        }
        catch (Exception exception) when (ShouldWrapProcessingException(exception))
        {
            throw new OcrProcessingException($"OCR processing failed for page {documentPage.PageNumber}.", exception);
        }
        finally
        {
            _engineGate.Release();
        }
    }

    /// <summary>
    /// Releases the native Tesseract engine owned by this instance.
    /// </summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposeSignaled, 1) != 0)
        {
            return;
        }

        _engineGate.Wait();
        try
        {
            _engine?.Dispose();
            _engine = null;
            _engineLanguageExpression = null;
        }
        finally
        {
            _engineGate.Release();
        }
    }

    private static string ResolveTessDataDirectory(string? tessDataDirectory, string assemblyDirectory)
    {
        if (tessDataDirectory is null)
        {
            return Path.GetFullPath(Path.Combine(assemblyDirectory, "TessData"));
        }

        if (string.IsNullOrWhiteSpace(tessDataDirectory))
        {
            throw new ArgumentException("The TessData directory must be a non-empty path when provided.", nameof(tessDataDirectory));
        }

        return Path.GetFullPath(tessDataDirectory);
    }

    private static string ResolveAssemblyDirectory()
    {
        var assemblyLocation = typeof(TesseractOcrEngine).Assembly.Location;

        if (!string.IsNullOrWhiteSpace(assemblyLocation))
        {
            return Path.GetDirectoryName(assemblyLocation)
                ?? throw new InvalidOperationException("The TesseractOcrEngine assembly directory could not be determined.");
        }

        return AppContext.BaseDirectory;
    }

    private static string[] NormalizeLanguages(IEnumerable<string> languages)
    {
        var normalizedLanguages = new List<string>();
        var seenLanguages = new HashSet<string>(StringComparer.Ordinal);

        foreach (var language in languages)
        {
            ArgumentNullException.ThrowIfNull(language);

            var trimmedLanguage = language.Trim();

            if (trimmedLanguage.Contains('+', StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    $"Tesseract language '{trimmedLanguage}' is not supported as a combined expression here. Supply separate entries instead, for example [\"eng\", \"ara\"].",
                    nameof(languages));
            }

            if (!SupportedLanguageCodePattern.IsMatch(trimmedLanguage))
            {
                throw new ArgumentException(
                    $"Tesseract language '{trimmedLanguage}' is invalid. Use lowercase letters, digits, and underscores only, with a maximum length of 64 characters.",
                    nameof(languages));
            }

            if (!seenLanguages.Add(trimmedLanguage))
            {
                throw new ArgumentException(
                    $"Duplicate Tesseract language '{trimmedLanguage}' is not allowed.",
                    nameof(languages));
            }

            normalizedLanguages.Add(trimmedLanguage);
        }

        return normalizedLanguages.ToArray();
    }

    private static async Task<byte[]> ReadImageBytesAsync(Stream imageStream, CancellationToken cancellationToken)
    {
        var inputWasSeekable = imageStream.CanSeek;
        var originalPosition = inputWasSeekable ? imageStream.Position : 0L;

        try
        {
            if (inputWasSeekable)
            {
                imageStream.Position = 0;
            }

            using var buffer = new MemoryStream();
            await imageStream.CopyToAsync(buffer, 81920, cancellationToken).ConfigureAwait(false);
            return buffer.ToArray();
        }
        finally
        {
            if (inputWasSeekable)
            {
                imageStream.Position = originalPosition;
            }
        }
    }

    private static string NormalizeLineEndings(string text)
    {
        return text
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n');
    }

    private static double ConvertConfidence(float rawConfidence, int pageNumber)
    {
        if (float.IsNaN(rawConfidence) || float.IsInfinity(rawConfidence))
        {
            throw new OcrProcessingException(
                $"OCR processing failed for page {pageNumber}.",
                new InvalidOperationException("Tesseract returned a non-finite confidence value."));
        }

        var convertedConfidence = Math.Clamp(rawConfidence * 100d, 0d, 100d);

        if (double.IsNaN(convertedConfidence) || double.IsInfinity(convertedConfidence))
        {
            throw new OcrProcessingException(
                $"OCR processing failed for page {pageNumber}.",
                new InvalidOperationException("The OCR confidence value could not be normalized."));
        }

        return convertedConfidence;
    }

    private static bool ShouldWrapProcessingException(Exception exception)
    {
        return exception is not OperationCanceledException
            and not OcrProcessingException
            and not ObjectDisposedException
            and not OutOfMemoryException
            and not StackOverflowException
            and not AccessViolationException
            and not AppDomainUnloadedException
            and not CannotUnloadAppDomainException;
    }

    private void EnsureLanguageDataExists(IEnumerable<string> normalizedLanguages, string languageExpression, int pageNumber)
    {
        if (!Directory.Exists(TessDataDirectory))
        {
            throw CreateEngineInitializationException(
                pageNumber,
                languageExpression,
                new DirectoryNotFoundException($"The TessData directory '{TessDataDirectory}' does not exist."));
        }

        foreach (var language in normalizedLanguages)
        {
            var trainedDataPath = Path.Combine(TessDataDirectory, $"{language}.traineddata");

            if (!File.Exists(trainedDataPath))
            {
                throw CreateEngineInitializationException(
                    pageNumber,
                    languageExpression,
                    new FileNotFoundException("The requested Tesseract trained-data file could not be found.", trainedDataPath));
            }
        }
    }

    private void EnsureEngineInitialized(string languageExpression, int pageNumber)
    {
        if (_engine is not null && string.Equals(_engineLanguageExpression, languageExpression, StringComparison.Ordinal))
        {
            return;
        }

        _engine?.Dispose();
        _engine = null;
        _engineLanguageExpression = null;

        TesseractEnviornment.CustomSearchPath = _nativeSearchRoot;

        try
        {
            _engine = new TesseractEngine(TessDataDirectory, languageExpression, EngineMode.LstmOnly);
            _engineLanguageExpression = languageExpression;
        }
        catch (Exception exception) when (ShouldWrapProcessingException(exception))
        {
            throw CreateEngineInitializationException(pageNumber, languageExpression, exception);
        }
    }

    private static Pix LoadPix(byte[] imageBytes, int pageNumber)
    {
        try
        {
            return Pix.LoadFromMemory(imageBytes);
        }
        catch (Exception exception) when (ShouldWrapProcessingException(exception))
        {
            throw new OcrProcessingException($"OCR processing failed for page {pageNumber}.", exception);
        }
    }

    private Page ProcessPage(Pix pix, int pageNumber)
    {
        if (_engine is null)
        {
            throw new InvalidOperationException("The Tesseract engine has not been initialized.");
        }

        try
        {
            return _engine.Process(pix);
        }
        catch (Exception exception) when (ShouldWrapProcessingException(exception))
        {
            throw new OcrProcessingException($"OCR processing failed for page {pageNumber}.", exception);
        }
    }

    private OcrProcessingException CreateEngineInitializationException(int pageNumber, string languageExpression, Exception innerException)
    {
        return new OcrProcessingException(
            $"Unable to initialize OCR engine for page {pageNumber} with language '{languageExpression}' using TessData '{TessDataDirectory}'.",
            innerException);
    }

    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposeSignaled) != 0)
        {
            throw new ObjectDisposedException(nameof(TesseractOcrEngine));
        }
    }
}
