using BitMiracle.LibTiff.Classic;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Imaging;

internal static class TiffImageDecoder
{
    public static SKBitmap DecodeFirstImage(byte[] imageBytes, bool normalizeOrientation, CancellationToken cancellationToken)
    {
        using var inputStream = new MemoryStream(imageBytes, writable: false);
        using var tiff = Tiff.ClientOpen("memory", "r", inputStream, new StreamTiffAdapter())
            ?? throw new InvalidOperationException("The TIFF image could not be opened.");

        var width = GetRequiredField(tiff, TiffTag.IMAGEWIDTH);
        var height = GetRequiredField(tiff, TiffTag.IMAGELENGTH);
        var sourceOrientation = GetOrientation(tiff);
        var raster = new int[checked(width * height)];

        cancellationToken.ThrowIfCancellationRequested();

        if (!tiff.ReadRGBAImageOriented(width, height, raster, sourceOrientation, stopOnError: false))
        {
            throw new InvalidOperationException("The TIFF image pixels could not be decoded.");
        }

        var decodedBitmap = BuildBitmapFromRaster(width, height, raster, cancellationToken);

        if (!normalizeOrientation || sourceOrientation == Orientation.TOPLEFT)
        {
            return decodedBitmap;
        }

        try
        {
            return BitmapOrientationTransformer.Apply(decodedBitmap, MapOrientation(sourceOrientation), cancellationToken);
        }
        finally
        {
            decodedBitmap.Dispose();
        }
    }

    private static int GetRequiredField(Tiff tiff, TiffTag tag)
    {
        var fieldValues = tiff.GetField(tag);

        if (fieldValues is null || fieldValues.Length == 0)
        {
            throw new InvalidOperationException($"The TIFF image is missing the required {tag} field.");
        }

        return fieldValues[0].ToInt();
    }

    private static Orientation GetOrientation(Tiff tiff)
    {
        var orientationField = tiff.GetField(TiffTag.ORIENTATION);

        if (orientationField is null || orientationField.Length == 0)
        {
            return Orientation.TOPLEFT;
        }

        var orientationValue = orientationField[0].ToInt();
        return Enum.IsDefined(typeof(Orientation), orientationValue)
            ? (Orientation)orientationValue
            : Orientation.TOPLEFT;
    }

    private static SKBitmap BuildBitmapFromRaster(int width, int height, int[] raster, CancellationToken cancellationToken)
    {
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Unpremul));

        try
        {
            for (var y = 0; y < height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var x = 0; x < width; x++)
                {
                    var pixel = raster[(y * width) + x];
                    bitmap.SetPixel(
                        x,
                        y,
                        new SKColor(
                            (byte)Tiff.GetR(pixel),
                            (byte)Tiff.GetG(pixel),
                            (byte)Tiff.GetB(pixel),
                            (byte)Tiff.GetA(pixel)));
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

    private static SKEncodedOrigin MapOrientation(Orientation orientation)
    {
        return orientation switch
        {
            Orientation.TOPLEFT => SKEncodedOrigin.TopLeft,
            Orientation.TOPRIGHT => SKEncodedOrigin.TopRight,
            Orientation.BOTRIGHT => SKEncodedOrigin.BottomRight,
            Orientation.BOTLEFT => SKEncodedOrigin.BottomLeft,
            Orientation.LEFTTOP => SKEncodedOrigin.LeftTop,
            Orientation.RIGHTTOP => SKEncodedOrigin.RightTop,
            Orientation.RIGHTBOT => SKEncodedOrigin.RightBottom,
            Orientation.LEFTBOT => SKEncodedOrigin.LeftBottom,
            _ => SKEncodedOrigin.TopLeft,
        };
    }
}
