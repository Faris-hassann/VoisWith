using BitMiracle.LibTiff.Classic;

namespace DocumentOcr.Infrastructure.Imaging;

internal sealed class StreamTiffAdapter : TiffStream
{
    public override void Close(object clientData)
    {
        ((Stream)clientData).Dispose();
    }

    public override int Read(object clientData, byte[] buffer, int offset, int count)
    {
        return ((Stream)clientData).Read(buffer, offset, count);
    }

    public override long Seek(object clientData, long offset, SeekOrigin origin)
    {
        return ((Stream)clientData).Seek(offset, origin);
    }

    public override long Size(object clientData)
    {
        return ((Stream)clientData).Length;
    }

    public override void Write(object clientData, byte[] buffer, int offset, int count)
    {
        throw new NotSupportedException("Writing TIFF data is not supported by this adapter.");
    }
}
