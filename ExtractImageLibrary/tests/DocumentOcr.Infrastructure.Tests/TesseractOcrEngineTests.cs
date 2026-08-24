using System.Security.Cryptography;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Infrastructure.Ocr;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Tests;

public sealed class TesseractOcrEngineTests
{
    [Fact]
    public async Task RecognizeAsync_UsesDefaultAssemblyRelativeTessDataAndRecognizesEnglishText()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(4, File.OpenRead(FixturePaths.OcrHelloPng));

        var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);

        Assert.Equal(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "TessData")), engine.TessDataDirectory);
        Assert.Equal(4, result.PageNumber);
        Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("OCR", result.Text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("123", result.Text, StringComparison.OrdinalIgnoreCase);
        Assert.InRange(result.Confidence, 0d, 100d);
    }

    [Fact]
    public async Task RecognizeAsync_AllowsRepeatedRecognitionOnSameEngineInstance()
    {
        using var engine = new TesseractOcrEngine();
        var options = new OcrOptions(new[] { "eng" });

        await using var firstPage = new DocumentPage(1, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));
        await using var secondPage = new DocumentPage(2, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var firstResult = await engine.RecognizeAsync(firstPage, options, CancellationToken.None);
        var secondResult = await engine.RecognizeAsync(secondPage, options, CancellationToken.None);

        Assert.Contains("HELLO", firstResult.Text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("HELLO", secondResult.Text, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, firstResult.PageNumber);
        Assert.Equal(2, secondResult.PageNumber);
    }

    [Fact]
    public async Task RecognizeAsync_ReturnsValidResultForBlankImage()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(5, new MemoryStream(CreateBlankPng(320, 120)));

        var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);

        Assert.Equal(5, result.PageNumber);
        Assert.True(string.IsNullOrWhiteSpace(result.Text));
        Assert.InRange(result.Confidence, 0d, 100d);
    }

    [Fact]
    public async Task RecognizeAsync_UsesExplicitTessDataDirectoryOverrideAndCanonicalizesProperty()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var tessDataDirectory = Path.Combine(temporaryDirectory.Path, "nested", "tessdata-override");
        Directory.CreateDirectory(tessDataDirectory);
        File.Copy(GetBundledTrainedDataPath(), Path.Combine(tessDataDirectory, "eng.traineddata"));

        using var engine = new TesseractOcrEngine(Path.Combine(temporaryDirectory.Path, "nested", "..", "nested", "tessdata-override"));
        await using var page = new DocumentPage(6, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);

        Assert.Equal(Path.GetFullPath(tessDataDirectory), engine.TessDataDirectory);
        Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BundledEnglishTrainedData_MatchesPinnedLengthAndSha256()
    {
        var trainedDataPath = GetBundledTrainedDataPath();
        var bytes = File.ReadAllBytes(trainedDataPath);
        var hash = Convert.ToHexString(SHA256.HashData(bytes));

        Assert.Equal(4_113_088L, new FileInfo(trainedDataPath).Length);
        Assert.Equal("7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2", hash);
    }

    [Fact]
    public void BundledTessDataLicense_IsCopiedToOutput()
    {
        var licensePath = Path.Combine(AppContext.BaseDirectory, "TessData", "LICENSE.tessdata_fast.txt");
        var licenseText = File.ReadAllText(licensePath);

        Assert.True(File.Exists(licensePath));
        Assert.Contains("Apache License", licenseText, StringComparison.Ordinal);
        Assert.Contains("Version 2.0", licenseText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("ENG")]
    [InlineData("eng+ara")]
    [InlineData("../eng")]
    [InlineData(@"eng\ara")]
    [InlineData("eng/ara")]
    [InlineData("eng:ara")]
    [InlineData("eng.ara")]
    [InlineData("eng ara")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task RecognizeAsync_RejectsInvalidLanguagesBeforeReadingInput(string language)
    {
        using var engine = new TesseractOcrEngine();
        var inputStream = new TrackingReadStream(File.ReadAllBytes(FixturePaths.OcrHelloPng));
        await using var page = new DocumentPage(9, inputStream);

        var exception = await Assert.ThrowsAsync<ArgumentException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { language }), CancellationToken.None));

        Assert.Equal("languages", exception.ParamName);
        Assert.Equal(0, inputStream.TotalReadCalls);
    }

    [Fact]
    public async Task RecognizeAsync_RejectsDuplicateLanguagesBeforeReadingInput()
    {
        using var engine = new TesseractOcrEngine();
        var inputStream = new TrackingReadStream(File.ReadAllBytes(FixturePaths.OcrHelloPng));
        await using var page = new DocumentPage(9, inputStream);

        var exception = await Assert.ThrowsAsync<ArgumentException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng", "eng" }), CancellationToken.None));

        Assert.Contains("Duplicate Tesseract language 'eng' is not allowed.", exception.Message);
        Assert.Equal("languages", exception.ParamName);
        Assert.Equal(0, inputStream.TotalReadCalls);
    }

    [Fact]
    public async Task RecognizeAsync_RejectsCombinedLanguageExpressionAndExplainsCollectionSyntax()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(9, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var exception = await Assert.ThrowsAsync<ArgumentException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng+ara" }), CancellationToken.None));

        Assert.Contains("[\"eng\", \"ara\"]", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RecognizeAsync_FailsClearlyWhenDefaultTessDataIsMissing()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        using var engine = new TesseractOcrEngine(Path.Combine(temporaryDirectory.Path, "missing-tessdata"));
        await using var page = new DocumentPage(7, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None));

        Assert.Contains("page 7", exception.Message, StringComparison.Ordinal);
        Assert.Contains("language 'eng'", exception.Message, StringComparison.Ordinal);
        Assert.Contains(engine.TessDataDirectory, exception.Message, StringComparison.Ordinal);
        Assert.IsType<DirectoryNotFoundException>(exception.InnerException);
    }

    [Fact]
    public async Task RecognizeAsync_FailsClearlyWhenRequestedLanguageDataIsUnavailable()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(8, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "ara" }), CancellationToken.None));

        Assert.Contains("page 8", exception.Message, StringComparison.Ordinal);
        Assert.Contains("language 'ara'", exception.Message, StringComparison.Ordinal);
        Assert.Contains(engine.TessDataDirectory, exception.Message, StringComparison.Ordinal);
        Assert.IsType<FileNotFoundException>(exception.InnerException);
        Assert.Contains("ara.traineddata", ((FileNotFoundException)exception.InnerException).FileName, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RecognizeAsync_FailsWhenAnyRequestedLanguageIsMissingWithoutFallingBack()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(10, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng", "ara" }), CancellationToken.None));

        Assert.Contains("page 10", exception.Message, StringComparison.Ordinal);
        Assert.Contains("language 'eng+ara'", exception.Message, StringComparison.Ordinal);
        Assert.IsType<FileNotFoundException>(exception.InnerException);
    }

    [Fact]
    public async Task RecognizeAsync_WrapsCorruptImageInputWithPageContextAndRestoresSeekablePosition()
    {
        using var engine = new TesseractOcrEngine();
        using var inputStream = new MemoryStream(new byte[] { 0x00, 0x11, 0x22, 0x33, 0x44, 0x55 });
        inputStream.Position = 3;
        await using var page = new DocumentPage(11, inputStream);

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None));

        Assert.Equal("OCR processing failed for page 11.", exception.Message);
        Assert.NotNull(exception.InnerException);
        Assert.Equal(3, inputStream.Position);
    }

    [Fact]
    public async Task RecognizeAsync_HonorsPreCanceledToken()
    {
        using var engine = new TesseractOcrEngine();
        await using var page = new DocumentPage(12, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), cancellationSource.Token));
    }

    [Fact]
    public async Task RecognizeAsync_HonorsCancellationDuringAsyncCopy()
    {
        using var engine = new TesseractOcrEngine();
        using var cancellationSource = new CancellationTokenSource();
        var inputStream = new CancelDuringReadAsyncStream();
        await using var page = new DocumentPage(13, inputStream);

        var recognitionTask = engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), cancellationSource.Token);
        Assert.True(inputStream.ReadStarted.Wait(TimeSpan.FromSeconds(5)));
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await recognitionTask);
        Assert.False(inputStream.IsDisposed);
    }

    [Fact]
    public async Task RecognizeAsync_LeavesSeekableInputOpenAndRestoresPosition()
    {
        using var engine = new TesseractOcrEngine();
        var inputStream = new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng));
        inputStream.Position = 12;
        await using var page = new DocumentPage(14, inputStream);

        var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);

        Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
        Assert.True(inputStream.CanRead);
        Assert.Equal(12, inputStream.Position);
    }

    [Fact]
    public async Task RecognizeAsync_ConsumesNonSeekableInputFromItsCurrentLogicalPosition()
    {
        using var engine = new TesseractOcrEngine();
        var validPngBytes = File.ReadAllBytes(FixturePaths.OcrHelloPng);
        var prefixedBytes = new byte[17 + validPngBytes.Length];
        Array.Fill(prefixedBytes, (byte)0xFF, 0, 17);
        Buffer.BlockCopy(validPngBytes, 0, prefixedBytes, 17, validPngBytes.Length);

        var stream = new NonSeekableReadStream(prefixedBytes, initialPosition: 17);
        await using var page = new DocumentPage(15, stream);

        var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);

        Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
        Assert.True(stream.CanRead);
        Assert.False(stream.IsDisposed);
        Assert.True(stream.Position > 17);
    }

    [Fact]
    public async Task RecognizeAsync_ThrowsObjectDisposedExceptionAfterDispose()
    {
        var engine = new TesseractOcrEngine();
        engine.Dispose();
        engine.Dispose();

        await using var page = new DocumentPage(16, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng)));

        await Assert.ThrowsAsync<ObjectDisposedException>(
            async () => await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None));
    }

    [Fact]
    public async Task RecognizeAsync_ReleasesNativeResourcesSoTessDataDirectoryCanBeDeletedAfterDispose()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var tessDataDirectory = Path.Combine(temporaryDirectory.Path, "TessData");
        Directory.CreateDirectory(tessDataDirectory);
        File.Copy(GetBundledTrainedDataPath(), Path.Combine(tessDataDirectory, "eng.traineddata"));

        var engine = new TesseractOcrEngine(tessDataDirectory);
        await using (var page = new DocumentPage(17, new MemoryStream(File.ReadAllBytes(FixturePaths.OcrHelloPng))))
        {
            var result = await engine.RecognizeAsync(page, new OcrOptions(new[] { "eng" }), CancellationToken.None);
            Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
        }

        engine.Dispose();

        Directory.Delete(tessDataDirectory, recursive: true);

        Assert.False(Directory.Exists(tessDataDirectory));
    }

    [Fact]
    public async Task RecognizeAsync_RecoversAfterLanguageSwitchFailsDuringNativeInitialization()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        File.Copy(GetBundledTrainedDataPath(), Path.Combine(temporaryDirectory.Path, "eng.traineddata"));
        File.WriteAllBytes(Path.Combine(temporaryDirectory.Path, "ara.traineddata"), new byte[] { 0x01, 0x02, 0x03, 0x04 });

        using var engine = new TesseractOcrEngine(temporaryDirectory.Path);
        var pageBytes = File.ReadAllBytes(FixturePaths.OcrHelloPng);

        await using (var englishPage = new DocumentPage(18, new MemoryStream(pageBytes)))
        {
            var englishResult = await engine.RecognizeAsync(englishPage, new OcrOptions(new[] { "eng" }), CancellationToken.None);
            Assert.Contains("HELLO", englishResult.Text, StringComparison.OrdinalIgnoreCase);
        }

        await using (var arabicPage = new DocumentPage(19, new MemoryStream(pageBytes)))
        {
            var exception = await Assert.ThrowsAsync<OcrProcessingException>(
                async () => await engine.RecognizeAsync(arabicPage, new OcrOptions(new[] { "ara" }), CancellationToken.None));

            Assert.Contains("page 19", exception.Message, StringComparison.Ordinal);
            Assert.Contains("language 'ara'", exception.Message, StringComparison.Ordinal);
            Assert.Contains(engine.TessDataDirectory, exception.Message, StringComparison.Ordinal);
            Assert.NotNull(exception.InnerException);
            Assert.IsNotType<FileNotFoundException>(exception.InnerException);
            Assert.IsNotType<DirectoryNotFoundException>(exception.InnerException);
        }

        await using (var englishPageAfterFailure = new DocumentPage(20, new MemoryStream(pageBytes)))
        {
            var result = await engine.RecognizeAsync(englishPageAfterFailure, new OcrOptions(new[] { "eng" }), CancellationToken.None);
            Assert.Contains("HELLO", result.Text, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static string GetBundledTrainedDataPath()
    {
        return Path.Combine(AppContext.BaseDirectory, "TessData", "eng.traineddata");
    }

    private static byte[] CreateBlankPng(int width, int height)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height));
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.White);
        using var stream = new MemoryStream();

        if (!bitmap.Encode(stream, SKEncodedImageFormat.Png, 100))
        {
            throw new InvalidOperationException("Failed to encode blank PNG test fixture.");
        }

        return stream.ToArray();
    }

    private sealed class TrackingReadStream : MemoryStream
    {
        public TrackingReadStream(byte[] buffer)
            : base(buffer, writable: false)
        {
        }

        public int TotalReadCalls { get; private set; }

        public override int Read(byte[] buffer, int offset, int count)
        {
            TotalReadCalls++;
            return base.Read(buffer, offset, count);
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            TotalReadCalls++;
            return base.ReadAsync(buffer, offset, count, cancellationToken);
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            TotalReadCalls++;
            return base.ReadAsync(buffer, cancellationToken);
        }
    }

    private sealed class CancelDuringReadAsyncStream : Stream
    {
        public ManualResetEventSlim ReadStarted { get; } = new(initialState: false);

        public bool IsDisposed { get; private set; }

        public override bool CanRead => !IsDisposed;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            ReadStarted.Set();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
            return 0;
        }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            ReadStarted.Set();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
            return 0;
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            IsDisposed = true;
            ReadStarted.Dispose();
            base.Dispose(disposing);
        }
    }

    private sealed class NonSeekableReadStream : Stream
    {
        private readonly byte[] _buffer;
        private int _position;

        public NonSeekableReadStream(byte[] buffer, int initialPosition = 0)
        {
            _buffer = buffer;
            _position = initialPosition;
        }

        public bool IsDisposed { get; private set; }

        public override bool CanRead => !IsDisposed;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => _buffer.Length;

        public override long Position
        {
            get => _position;
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            ThrowIfDisposed();

            if (_position >= _buffer.Length)
            {
                return 0;
            }

            var bytesToCopy = Math.Min(count, _buffer.Length - _position);
            Buffer.BlockCopy(_buffer, _position, buffer, offset, bytesToCopy);
            _position += bytesToCopy;
            return bytesToCopy;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            ThrowIfDisposed();
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Read(buffer, offset, count));
        }

        public override ValueTask<int> ReadAsync(Memory<byte> destination, CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            cancellationToken.ThrowIfCancellationRequested();

            if (_position >= _buffer.Length)
            {
                return ValueTask.FromResult(0);
            }

            var bytesToCopy = Math.Min(destination.Length, _buffer.Length - _position);
            _buffer.AsMemory(_position, bytesToCopy).CopyTo(destination);
            _position += bytesToCopy;
            return ValueTask.FromResult(bytesToCopy);
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            IsDisposed = true;
            base.Dispose(disposing);
        }

        public override ValueTask DisposeAsync()
        {
            IsDisposed = true;
            return base.DisposeAsync();
        }

        private void ThrowIfDisposed()
        {
            if (IsDisposed)
            {
                throw new ObjectDisposedException(nameof(NonSeekableReadStream));
            }
        }
    }

}
