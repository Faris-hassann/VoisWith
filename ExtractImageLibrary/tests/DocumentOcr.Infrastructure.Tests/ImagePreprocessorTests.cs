using BitMiracle.LibTiff.Classic;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Infrastructure.Imaging;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Tests;

public sealed class ImagePreprocessorTests
{
    [Theory]
    [InlineData(nameof(FixturePaths.CleanTextPng))]
    [InlineData(nameof(FixturePaths.RotatedExifJpeg))]
    [InlineData(nameof(FixturePaths.SampleWebp))]
    [InlineData(nameof(FixturePaths.SampleBmp))]
    [InlineData(nameof(FixturePaths.SampleTiff))]
    public async Task ProcessAsync_ConvertsSupportedFormatsToDecodablePng(string fixtureName)
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = File.ReadAllBytes(GetFixtureImagePath(fixtureName));
        await using var inputPage = new DocumentPage(7, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);

        Assert.Equal(7, outputPage.PageNumber);
        Assert.Equal(0, outputPage.ImageStream.Position);

        var outputBytes = ReadAllBytes(outputPage.ImageStream);
        Assert.Equal(0x89, outputBytes[0]);
        Assert.Equal(0x50, outputBytes[1]);
        Assert.Equal(0x4E, outputBytes[2]);
        Assert.Equal(0x47, outputBytes[3]);

        using var bitmap = DecodeBitmap(outputBytes);
        Assert.NotNull(bitmap);
    }

    [Fact]
    public async Task ProcessAsync_NormalizesExifOrientationWhenEnabled()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = File.ReadAllBytes(FixturePaths.RotatedExifJpeg);
        await using var inputPage = new DocumentPage(3, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(
            inputPage,
            new OcrOptions(enableAutoRotate: true),
            CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.Equal(40, bitmap.Width);
        Assert.Equal(80, bitmap.Height);
        Assert.True(GetAverageLuminance(bitmap, 28, 0, 12, 12) < GetAverageLuminance(bitmap, 0, 0, 12, 12));
    }

    [Fact]
    public async Task ProcessAsync_PreservesEncodedOrientationWhenAutoRotateDisabled()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = File.ReadAllBytes(FixturePaths.RotatedExifJpeg);
        await using var inputPage = new DocumentPage(4, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(
            inputPage,
            new OcrOptions(enableAutoRotate: false),
            CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.Equal(80, bitmap.Width);
        Assert.Equal(40, bitmap.Height);
        Assert.True(GetAverageLuminance(bitmap, 0, 0, 12, 12) < GetAverageLuminance(bitmap, 60, 0, 12, 12));
    }

    [Fact]
    public async Task ProcessAsync_NormalizesRotatedTiffOrientationWhenEnabled()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = CreateMarkedTiff(Orientation.RIGHTTOP, width: 8, height: 4, markerLeft: 0, markerTop: 0);
        await using var inputPage = new DocumentPage(16, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(
            inputPage,
            new OcrOptions(enableAutoRotate: true),
            CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.Equal(4, bitmap.Width);
        Assert.Equal(8, bitmap.Height);
        Assert.True(GetAverageLuminance(bitmap, 2, 0, 2, 2) < GetAverageLuminance(bitmap, 0, 0, 2, 2));
    }

    [Fact]
    public async Task ProcessAsync_NormalizesTransposedTiffOrientationWhenEnabled()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = CreateMarkedTiff(Orientation.LEFTTOP, width: 8, height: 4, markerLeft: 6, markerTop: 0);
        await using var inputPage = new DocumentPage(17, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(
            inputPage,
            new OcrOptions(enableAutoRotate: true),
            CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.Equal(4, bitmap.Width);
        Assert.Equal(8, bitmap.Height);
        Assert.True(GetAverageLuminance(bitmap, 0, 6, 2, 2) < GetAverageLuminance(bitmap, 0, 0, 2, 2));
    }

    [Fact]
    public async Task ProcessAsync_PreservesEncodedTiffOrientationWhenAutoRotateDisabled()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = CreateMarkedTiff(Orientation.RIGHTTOP, width: 8, height: 4, markerLeft: 0, markerTop: 0);
        await using var inputPage = new DocumentPage(18, new MemoryStream(bytes));

        await using var outputPage = await preprocessor.ProcessAsync(
            inputPage,
            new OcrOptions(enableAutoRotate: false),
            CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.Equal(8, bitmap.Width);
        Assert.Equal(4, bitmap.Height);
        Assert.True(GetAverageLuminance(bitmap, 0, 0, 2, 2) < GetAverageLuminance(bitmap, 6, 0, 2, 2));
    }

    [Fact]
    public async Task ProcessAsync_ProducesGrayscaleOutputAndPreservesAlpha()
    {
        var preprocessor = new ImagePreprocessor();
        var inputBytes = CreateTransparentColorPng();
        await using var inputPage = new DocumentPage(5, new MemoryStream(inputBytes));

        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);

        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));
        var topLeft = bitmap.GetPixel(0, 0);
        var topRight = bitmap.GetPixel(1, 0);
        var bottomLeft = bitmap.GetPixel(0, 1);
        var bottomRight = bitmap.GetPixel(1, 1);

        Assert.Equal(topLeft.Red, topLeft.Green);
        Assert.Equal(topLeft.Green, topLeft.Blue);
        Assert.Equal(topRight.Red, topRight.Green);
        Assert.Equal(topRight.Green, topRight.Blue);
        Assert.Equal(bottomLeft.Red, bottomLeft.Green);
        Assert.Equal(bottomLeft.Green, bottomLeft.Blue);
        Assert.Equal(bottomRight.Red, bottomRight.Green);
        Assert.Equal(bottomRight.Green, bottomRight.Blue);

        Assert.Equal((byte)64, topLeft.Alpha);
        Assert.Equal((byte)128, topRight.Alpha);
        Assert.Equal((byte)192, bottomLeft.Alpha);
        Assert.Equal((byte)255, bottomRight.Alpha);
    }

    [Fact]
    public async Task ProcessAsync_ImprovesLowContrastWithoutDegeneratingOutput()
    {
        var preprocessor = new ImagePreprocessor();
        var sourceBytes = File.ReadAllBytes(FixturePaths.LowContrastPng);
        await using var inputPage = new DocumentPage(6, new MemoryStream(sourceBytes));

        using var sourceBitmap = DecodeBitmap(sourceBytes);
        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);
        using var processedBitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        var sourceRange = GetLuminanceRange(sourceBitmap);
        var processedRange = GetLuminanceRange(processedBitmap);

        Assert.True(processedRange > sourceRange);
        Assert.True(processedRange < 255);
    }

    [Fact]
    public async Task ProcessAsync_PreservesUniformGrayInteriorWithinOneLevel()
    {
        var preprocessor = new ImagePreprocessor();
        var sourceBytes = CreateUniformGrayPng(10, 10, 140);
        await using var inputPage = new DocumentPage(19, new MemoryStream(sourceBytes));

        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);
        using var processedBitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        for (var y = 1; y < processedBitmap.Height - 1; y++)
        {
            for (var x = 1; x < processedBitmap.Width - 1; x++)
            {
                var luminance = processedBitmap.GetPixel(x, y).Red;
                Assert.InRange(luminance, 139, 141);
            }
        }
    }

    [Fact]
    public async Task ProcessAsync_SharpensSoftEdgeWithoutOvershoot()
    {
        var preprocessor = new ImagePreprocessor();
        var sourceBytes = CreateSoftEdgePng();
        await using var inputPage = new DocumentPage(8, new MemoryStream(sourceBytes));

        using var sourceBitmap = DecodeBitmap(sourceBytes);
        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);
        using var processedBitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        Assert.True(GetMaximumHorizontalGradient(processedBitmap) > GetMaximumHorizontalGradient(sourceBitmap));
        var leftPlateau = GetAverageLuminance(processedBitmap, 0, 0, 8, processedBitmap.Height);
        var rightPlateau = GetAverageLuminance(processedBitmap, 24, 0, 8, processedBitmap.Height);
        var centerBand = GetAverageLuminance(processedBitmap, 13, 0, 6, processedBitmap.Height);

        Assert.InRange(Math.Abs(leftPlateau - rightPlateau), 0, 1);
        Assert.True(centerBand < leftPlateau);
        Assert.InRange(GetMinimumLuminance(processedBitmap), 0, 255);
        Assert.InRange(GetMaximumLuminance(processedBitmap), 0, 255);
    }

    [Fact]
    public async Task ProcessAsync_WrapsCorruptImageFailuresWithContext()
    {
        var preprocessor = new ImagePreprocessor();
        await using var inputPage = new DocumentPage(9, new MemoryStream(new byte[] { 0x01, 0x02, 0x03, 0x04 }));

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None));

        Assert.Equal("Unable to preprocess document page 9.", exception.Message);
        Assert.NotNull(exception.InnerException);
    }

    [Fact]
    public async Task ProcessAsync_WrapsEmptyImageFailuresWithContext()
    {
        var preprocessor = new ImagePreprocessor();
        await using var inputPage = new DocumentPage(10, new MemoryStream());

        var exception = await Assert.ThrowsAsync<OcrProcessingException>(
            async () => await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None));

        Assert.Equal("Unable to preprocess document page 10.", exception.Message);
        Assert.NotNull(exception.InnerException);
    }

    [Fact]
    public async Task ProcessAsync_HonorsPreCanceledToken()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = File.ReadAllBytes(FixturePaths.CleanTextPng);
        await using var inputPage = new DocumentPage(11, new MemoryStream(bytes));
        using var cancellationSource = new CancellationTokenSource();
        cancellationSource.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await preprocessor.ProcessAsync(inputPage, new OcrOptions(), cancellationSource.Token));
    }

    [Fact]
    public async Task ProcessAsync_HonorsMidCopyCancellation()
    {
        var preprocessor = new ImagePreprocessor();
        using var cancellationSource = new CancellationTokenSource();
        var bytes = File.ReadAllBytes(FixturePaths.SampleBmp);
        await using var inputPage = new DocumentPage(
            12,
            new ChunkedNonSeekableReadStream(bytes, 64, () => cancellationSource.Cancel()));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await preprocessor.ProcessAsync(inputPage, new OcrOptions(), cancellationSource.Token));
    }

    [Fact]
    public async Task ProcessAsync_LeavesSeekableInputOpenAndRestoresPosition()
    {
        var preprocessor = new ImagePreprocessor();
        var bytes = File.ReadAllBytes(FixturePaths.CleanTextPng);
        var inputStream = new MemoryStream(bytes);
        inputStream.Position = 10;
        await using var inputPage = new DocumentPage(13, inputStream);

        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);

        Assert.True(inputStream.CanRead);
        Assert.Equal(10, inputStream.Position);
        Assert.True(outputPage.ImageStream.CanRead);
    }

    [Fact]
    public async Task ProcessAsync_ReturnsIndependentlyOwnedOutputPage()
    {
        var preprocessor = new ImagePreprocessor();
        var inputStream = new MemoryStream(File.ReadAllBytes(FixturePaths.CleanTextPng));
        await using var inputPage = new DocumentPage(14, inputStream);

        var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);
        await outputPage.DisposeAsync();

        Assert.True(inputStream.CanRead);

        await inputPage.DisposeAsync();

        Assert.Throws<ObjectDisposedException>(() => _ = inputStream.Position);
    }

    [Fact]
    public async Task ProcessAsync_DoesNotLeaveUnderlyingFileLocked()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var imagePath = temporaryDirectory.CopyFile(FixturePaths.SampleBmp, "locked-image.bmp");
        var preprocessor = new ImagePreprocessor();
        await using var inputStream = new FileStream(imagePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        await using var inputPage = new DocumentPage(15, inputStream);

        await using var outputPage = await preprocessor.ProcessAsync(inputPage, new OcrOptions(), CancellationToken.None);
        using var bitmap = DecodeBitmap(ReadAllBytes(outputPage.ImageStream));

        await outputPage.DisposeAsync();
        await inputPage.DisposeAsync();

        File.Delete(imagePath);

        Assert.False(File.Exists(imagePath));
    }

    private static string GetFixtureImagePath(string fixtureName) =>
        fixtureName switch
        {
            nameof(FixturePaths.CleanTextPng) => FixturePaths.CleanTextPng,
            nameof(FixturePaths.RotatedExifJpeg) => FixturePaths.RotatedExifJpeg,
            nameof(FixturePaths.SampleWebp) => FixturePaths.SampleWebp,
            nameof(FixturePaths.SampleBmp) => FixturePaths.SampleBmp,
            nameof(FixturePaths.SampleTiff) => FixturePaths.SampleTiff,
            _ => throw new ArgumentOutOfRangeException(nameof(fixtureName)),
        };

    private static SKBitmap DecodeBitmap(byte[] bytes) =>
        SKBitmap.Decode(bytes) ?? throw new InvalidOperationException("Expected a decodable bitmap.");

    private static byte[] ReadAllBytes(Stream stream)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);

        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        return buffer.ToArray();
    }

    private static double GetAverageLuminance(SKBitmap bitmap, int x, int y, int width, int height)
    {
        long total = 0;
        var count = 0;

        for (var row = y; row < y + height; row++)
        {
            for (var column = x; column < x + width; column++)
            {
                total += bitmap.GetPixel(column, row).Red;
                count++;
            }
        }

        return total / (double)count;
    }

    private static int GetLuminanceRange(SKBitmap bitmap)
    {
        var minimum = 255;
        var maximum = 0;

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                var luminance = bitmap.GetPixel(x, y).Red;
                minimum = Math.Min(minimum, luminance);
                maximum = Math.Max(maximum, luminance);
            }
        }

        return maximum - minimum;
    }

    private static int GetMinimumLuminance(SKBitmap bitmap)
    {
        var minimum = 255;

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                minimum = Math.Min(minimum, bitmap.GetPixel(x, y).Red);
            }
        }

        return minimum;
    }

    private static int GetMaximumLuminance(SKBitmap bitmap)
    {
        var maximum = 0;

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                maximum = Math.Max(maximum, bitmap.GetPixel(x, y).Red);
            }
        }

        return maximum;
    }

    private static int GetMaximumHorizontalGradient(SKBitmap bitmap)
    {
        var maximum = 0;

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 1; x < bitmap.Width; x++)
            {
                var current = bitmap.GetPixel(x, y).Red;
                var previous = bitmap.GetPixel(x - 1, y).Red;
                maximum = Math.Max(maximum, Math.Abs(current - previous));
            }
        }

        return maximum;
    }

    private static byte[] CreateTransparentColorPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Bgra8888, SKAlphaType.Unpremul));
        bitmap.SetPixel(0, 0, new SKColor(255, 0, 0, 64));
        bitmap.SetPixel(1, 0, new SKColor(0, 255, 0, 128));
        bitmap.SetPixel(0, 1, new SKColor(0, 0, 255, 192));
        bitmap.SetPixel(1, 1, new SKColor(255, 255, 0, 255));
        return EncodePng(bitmap);
    }

    private static byte[] CreateUniformGrayPng(int width, int height, byte value)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                bitmap.SetPixel(x, y, new SKColor(value, value, value, 255));
            }
        }

        return EncodePng(bitmap);
    }

    private static byte[] CreateSoftEdgePng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(32, 16, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                byte value = x switch
                {
                    < 11 => 180,
                    11 => 170,
                    12 => 160,
                    13 => 145,
                    14 => 135,
                    15 => 125,
                    16 => 135,
                    17 => 145,
                    18 => 160,
                    19 => 170,
                    _ => 180,
                };

                bitmap.SetPixel(x, y, new SKColor(value, value, value, 255));
            }
        }

        return EncodePng(bitmap);
    }

    private static byte[] CreateMarkedTiff(Orientation orientation, int width, int height, int markerLeft, int markerTop)
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var tiffPath = Path.Combine(temporaryDirectory.Path, $"{orientation}.tiff");

        using (var tiff = Tiff.Open(tiffPath, "w") ?? throw new InvalidOperationException("Unable to create TIFF test fixture."))
        {
            tiff.SetField(TiffTag.IMAGEWIDTH, width);
            tiff.SetField(TiffTag.IMAGELENGTH, height);
            tiff.SetField(TiffTag.SAMPLESPERPIXEL, 3);
            tiff.SetField(TiffTag.BITSPERSAMPLE, 8);
            tiff.SetField(TiffTag.ORIENTATION, (short)orientation);
            tiff.SetField(TiffTag.ROWSPERSTRIP, height);
            tiff.SetField(TiffTag.XRESOLUTION, 72.0);
            tiff.SetField(TiffTag.YRESOLUTION, 72.0);
            tiff.SetField(TiffTag.RESOLUTIONUNIT, ResUnit.INCH);
            tiff.SetField(TiffTag.PHOTOMETRIC, Photometric.RGB);
            tiff.SetField(TiffTag.PLANARCONFIG, PlanarConfig.CONTIG);
            tiff.SetField(TiffTag.COMPRESSION, Compression.NONE);

            var scanline = new byte[width * 3];

            for (var y = 0; y < height; y++)
            {
                for (var x = 0; x < width; x++)
                {
                    var index = x * 3;
                    var isMarker = x >= markerLeft && x < markerLeft + 2 && y >= markerTop && y < markerTop + 2;
                    var value = isMarker ? (byte)0 : (byte)255;
                    scanline[index] = value;
                    scanline[index + 1] = value;
                    scanline[index + 2] = value;
                }

                tiff.WriteScanline(scanline, y);
            }

            tiff.WriteDirectory();
        }

        return File.ReadAllBytes(tiffPath);
    }

    private static byte[] EncodePng(SKBitmap bitmap)
    {
        using var stream = new MemoryStream();

        if (!bitmap.Encode(stream, SKEncodedImageFormat.Png, 100))
        {
            throw new InvalidOperationException("Test fixture PNG encoding failed.");
        }

        return stream.ToArray();
    }

    private sealed class ChunkedNonSeekableReadStream : Stream
    {
        private readonly byte[] _buffer;
        private readonly int _chunkSize;
        private readonly Action _afterFirstRead;
        private bool _afterFirstReadInvoked;
        private int _position;

        public ChunkedNonSeekableReadStream(byte[] buffer, int chunkSize, Action afterFirstRead)
        {
            _buffer = buffer;
            _chunkSize = chunkSize;
            _afterFirstRead = afterFirstRead;
        }

        public override bool CanRead => true;

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
            if (_position >= _buffer.Length)
            {
                return 0;
            }

            var bytesToCopy = Math.Min(Math.Min(count, _chunkSize), _buffer.Length - _position);
            Buffer.BlockCopy(_buffer, _position, buffer, offset, bytesToCopy);
            _position += bytesToCopy;
            InvokeCancellationAfterFirstRead();
            return bytesToCopy;
        }

        public override ValueTask<int> ReadAsync(Memory<byte> destination, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (_position >= _buffer.Length)
            {
                return ValueTask.FromResult(0);
            }

            var bytesToCopy = Math.Min(_chunkSize, Math.Min(destination.Length, _buffer.Length - _position));
            _buffer.AsMemory(_position, bytesToCopy).CopyTo(destination);
            _position += bytesToCopy;
            InvokeCancellationAfterFirstRead();
            return ValueTask.FromResult(bytesToCopy);
        }

        public override int ReadByte()
        {
            if (_position >= _buffer.Length)
            {
                return -1;
            }

            var value = _buffer[_position];
            _position++;
            InvokeCancellationAfterFirstRead();
            return value;
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        private void InvokeCancellationAfterFirstRead()
        {
            if (_afterFirstReadInvoked)
            {
                return;
            }

            _afterFirstReadInvoked = true;
            _afterFirstRead();
        }
    }
}
