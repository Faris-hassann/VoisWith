using DocumentOcr.Core.Abstractions;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Infrastructure;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Imaging;

/// <summary>
/// Applies conservative OCR-oriented image preprocessing.
/// </summary>
public sealed class ImagePreprocessor : IImagePreprocessor
{
    private const int HistogramBinCount = 256;
    private const double LowerPercentile = 0.05d;
    private const double UpperPercentile = 0.95d;

    /// <inheritdoc />
    public async Task<DocumentPage> ProcessAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(documentPage);
        ArgumentNullException.ThrowIfNull(options);

        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            NativeDependencyLoader.EnsureSkiaSharp();
            var inputBytes = await ReadInputBytesAsync(documentPage.ImageStream, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();

            using var decodedBitmap = DecodeBitmap(inputBytes, options.EnableAutoRotate, cancellationToken);
            using var processedBitmap = ProcessBitmap(decodedBitmap, cancellationToken);
            var outputStream = EncodeToPng(processedBitmap, cancellationToken);
            return new DocumentPage(documentPage.PageNumber, outputStream);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (OcrProcessingException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new OcrProcessingException($"Unable to preprocess document page {documentPage.PageNumber}.", exception);
        }
    }

    private static async Task<byte[]> ReadInputBytesAsync(Stream inputStream, CancellationToken cancellationToken)
    {
        var inputWasSeekable = inputStream.CanSeek;
        var originalPosition = inputWasSeekable ? inputStream.Position : 0L;

        try
        {
            if (inputWasSeekable)
            {
                inputStream.Position = 0;
            }

            using var buffer = new MemoryStream();
            await inputStream.CopyToAsync(buffer, 81920, cancellationToken).ConfigureAwait(false);
            return buffer.ToArray();
        }
        finally
        {
            if (inputWasSeekable)
            {
                inputStream.Position = originalPosition;
            }
        }
    }

    private static SKBitmap DecodeBitmap(byte[] imageBytes, bool enableAutoRotate, CancellationToken cancellationToken)
    {
        if (imageBytes.Length == 0)
        {
            throw new InvalidOperationException("The source image stream is empty.");
        }

        if (IsTiff(imageBytes))
        {
            return TiffImageDecoder.DecodeFirstImage(imageBytes, enableAutoRotate, cancellationToken);
        }

        using var imageStream = new MemoryStream(imageBytes, writable: false);
        using var codec = SKCodec.Create(imageStream)
            ?? throw new InvalidOperationException("The source image format could not be decoded.");
        using var decodedBitmap = SKBitmap.Decode(codec)
            ?? throw new InvalidOperationException("The source image pixels could not be decoded.");

        cancellationToken.ThrowIfCancellationRequested();

        return enableAutoRotate
            ? BitmapOrientationTransformer.Apply(decodedBitmap, codec.EncodedOrigin, cancellationToken)
            : BitmapOrientationTransformer.Copy(decodedBitmap, cancellationToken);
    }

    private static SKBitmap ProcessBitmap(SKBitmap sourceBitmap, CancellationToken cancellationToken)
    {
        using var normalizedBitmap = NormalizeBitmap(sourceBitmap, cancellationToken);
        var width = normalizedBitmap.Width;
        var height = normalizedBitmap.Height;
        var intensities = new byte[width * height];
        var alphaValues = new byte[width * height];

        ExtractLuminance(normalizedBitmap, intensities, alphaValues, cancellationToken);
        ApplyConservativeContrast(intensities, alphaValues, width, height, cancellationToken);
        var sharpened = ApplySharpening(intensities, width, height, cancellationToken);

        try
        {
            return BuildBitmap(sharpened, alphaValues, width, height, cancellationToken);
        }
        finally
        {
            Array.Clear(sharpened, 0, sharpened.Length);
        }
    }

    private static SKBitmap NormalizeBitmap(SKBitmap sourceBitmap, CancellationToken cancellationToken)
    {
        var normalizedBitmap = new SKBitmap(
            new SKImageInfo(sourceBitmap.Width, sourceBitmap.Height, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        try
        {
            using var canvas = new SKCanvas(normalizedBitmap);
            cancellationToken.ThrowIfCancellationRequested();
            canvas.Clear(SKColors.Transparent);
            canvas.DrawBitmap(sourceBitmap, 0, 0);
            canvas.Flush();
            cancellationToken.ThrowIfCancellationRequested();
            return normalizedBitmap;
        }
        catch
        {
            normalizedBitmap.Dispose();
            throw;
        }
    }

    private static void ExtractLuminance(SKBitmap bitmap, byte[] intensities, byte[] alphaValues, CancellationToken cancellationToken)
    {
        var index = 0;

        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            for (var x = 0; x < bitmap.Width; x++)
            {
                var color = bitmap.GetPixel(x, y);
                alphaValues[index] = color.Alpha;
                intensities[index] = ToLuminance(color);
                index++;
            }
        }
    }

    private static void ApplyConservativeContrast(byte[] intensities, byte[] alphaValues, int width, int height, CancellationToken cancellationToken)
    {
        var histogram = new int[HistogramBinCount];
        var sampleCount = 0;

        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var rowStart = y * width;

            for (var x = 0; x < width; x++)
            {
                var index = rowStart + x;

                if (alphaValues[index] == 0)
                {
                    continue;
                }

                histogram[intensities[index]]++;
                sampleCount++;
            }
        }

        if (sampleCount == 0)
        {
            return;
        }

        var lowerBound = FindPercentile(histogram, sampleCount, LowerPercentile);
        var upperBound = FindPercentile(histogram, sampleCount, UpperPercentile);

        if (upperBound - lowerBound < 10)
        {
            return;
        }

        var pixelIndex = 0;

        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            for (var x = 0; x < width; x++)
            {
                var original = intensities[pixelIndex];
                var stretched = StretchValue(original, lowerBound, upperBound);
                intensities[pixelIndex] = (byte)((original * 2 + stretched) / 3);
                pixelIndex++;
            }
        }
    }

    private static byte[] ApplySharpening(byte[] intensities, int width, int height, CancellationToken cancellationToken)
    {
        var sharpened = new byte[intensities.Length];
        Buffer.BlockCopy(intensities, 0, sharpened, 0, intensities.Length);

        if (width < 3 || height < 3)
        {
            return sharpened;
        }

        for (var y = 1; y < height - 1; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            for (var x = 1; x < width - 1; x++)
            {
                var index = y * width + x;
                var center = intensities[index];
                var left = intensities[index - 1];
                var right = intensities[index + 1];
                var top = intensities[index - width];
                var bottom = intensities[index + width];
                var sharpenedValue = (12 * center - left - right - top - bottom + 4) / 8;
                sharpened[index] = (byte)Math.Clamp(sharpenedValue, 0, 255);
            }
        }

        return sharpened;
    }

    private static SKBitmap BuildBitmap(byte[] intensities, byte[] alphaValues, int width, int height, CancellationToken cancellationToken)
    {
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Unpremul));
        var index = 0;

        try
        {
            for (var y = 0; y < height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var x = 0; x < width; x++)
                {
                    var intensity = intensities[index];
                    bitmap.SetPixel(x, y, new SKColor(intensity, intensity, intensity, alphaValues[index]));
                    index++;
                }
            }

            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }

    private static MemoryStream EncodeToPng(SKBitmap bitmap, CancellationToken cancellationToken)
    {
        var outputStream = new MemoryStream();

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!bitmap.Encode(outputStream, SKEncodedImageFormat.Png, 100))
            {
                throw new InvalidOperationException("The processed image could not be encoded as PNG.");
            }

            cancellationToken.ThrowIfCancellationRequested();
            outputStream.Position = 0;
            return outputStream;
        }
        catch
        {
            outputStream.Dispose();
            throw;
        }
    }

    private static byte ToLuminance(SKColor color)
    {
        var luminance = (color.Red * 54 + color.Green * 183 + color.Blue * 19 + 128) >> 8;
        return (byte)Math.Clamp(luminance, 0, 255);
    }

    private static int FindPercentile(int[] histogram, int sampleCount, double percentile)
    {
        var targetCount = (int)Math.Ceiling(sampleCount * percentile);
        var cumulativeCount = 0;

        for (var value = 0; value < histogram.Length; value++)
        {
            cumulativeCount += histogram[value];

            if (cumulativeCount >= targetCount)
            {
                return value;
            }
        }

        return histogram.Length - 1;
    }

    private static int StretchValue(int original, int lowerBound, int upperBound)
    {
        if (original <= lowerBound)
        {
            return 0;
        }

        if (original >= upperBound)
        {
            return 255;
        }

        return (original - lowerBound) * 255 / (upperBound - lowerBound);
    }

    private static bool IsTiff(byte[] imageBytes)
    {
        return imageBytes.Length >= 4 &&
            ((imageBytes[0] == 0x49 && imageBytes[1] == 0x49 && imageBytes[2] == 0x2A && imageBytes[3] == 0x00) ||
             (imageBytes[0] == 0x4D && imageBytes[1] == 0x4D && imageBytes[2] == 0x00 && imageBytes[3] == 0x2A));
    }
}

internal static class BitmapOrientationTransformer
{
    public static SKBitmap Copy(SKBitmap sourceBitmap, CancellationToken cancellationToken)
    {
        var copy = new SKBitmap(
            new SKImageInfo(sourceBitmap.Width, sourceBitmap.Height, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        try
        {
            for (var y = 0; y < sourceBitmap.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var x = 0; x < sourceBitmap.Width; x++)
                {
                    copy.SetPixel(x, y, sourceBitmap.GetPixel(x, y));
                }
            }

            return copy;
        }
        catch
        {
            copy.Dispose();
            throw;
        }
    }

    public static SKBitmap Apply(SKBitmap sourceBitmap, SKEncodedOrigin encodedOrigin, CancellationToken cancellationToken)
    {
        if (encodedOrigin == SKEncodedOrigin.Default || encodedOrigin == SKEncodedOrigin.TopLeft)
        {
            return Copy(sourceBitmap, cancellationToken);
        }

        var targetWidth = SwapsDimensions(encodedOrigin) ? sourceBitmap.Height : sourceBitmap.Width;
        var targetHeight = SwapsDimensions(encodedOrigin) ? sourceBitmap.Width : sourceBitmap.Height;
        var transformedBitmap = new SKBitmap(
            new SKImageInfo(targetWidth, targetHeight, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        try
        {
            for (var y = 0; y < targetHeight; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var x = 0; x < targetWidth; x++)
                {
                    var sourceCoordinates = MapSourceCoordinates(sourceBitmap.Width, sourceBitmap.Height, encodedOrigin, x, y);
                    transformedBitmap.SetPixel(x, y, sourceBitmap.GetPixel(sourceCoordinates.X, sourceCoordinates.Y));
                }
            }

            return transformedBitmap;
        }
        catch
        {
            transformedBitmap.Dispose();
            throw;
        }
    }

    private static (int X, int Y) MapSourceCoordinates(int width, int height, SKEncodedOrigin encodedOrigin, int x, int y)
    {
        return encodedOrigin switch
        {
            SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default => (x, y),
            SKEncodedOrigin.TopRight => (width - 1 - x, y),
            SKEncodedOrigin.BottomRight => (width - 1 - x, height - 1 - y),
            SKEncodedOrigin.BottomLeft => (x, height - 1 - y),
            SKEncodedOrigin.LeftTop => (y, x),
            SKEncodedOrigin.RightTop => (y, height - 1 - x),
            SKEncodedOrigin.RightBottom => (width - 1 - y, height - 1 - x),
            SKEncodedOrigin.LeftBottom => (width - 1 - y, x),
            _ => (x, y),
        };
    }

    private static bool SwapsDimensions(SKEncodedOrigin encodedOrigin)
    {
        return encodedOrigin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
    }
}
