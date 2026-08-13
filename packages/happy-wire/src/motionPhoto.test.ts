import { describe, expect, it } from 'vitest';
import { detectHonorMotionPhoto, detectMotionPhoto } from './motionPhoto';

function box(type: string, payload: number[]): Uint8Array {
  const output = new Uint8Array(8 + payload.length);
  new DataView(output.buffer).setUint32(0, output.length, false);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(payload, 8);
  return output;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

describe('detectHonorMotionPhoto', () => {
  it('returns the playable MP4 range and excludes the Honor uuid/footer', () => {
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const marker = new TextEncoder().encode('HiHonor_OfflineData\0');
    const playable = join(box('ftyp', [1, 2, 3, 4]), box('mdat', [5, 6]), box('moov', [7]));
    const bytes = join(cover, marker, playable, box('uuid', [8, 9]), new TextEncoder().encode('LIVE_123'));

    expect(detectHonorMotionPhoto(bytes)).toEqual({
      videoOffset: cover.length + marker.length,
      videoLength: playable.length,
      mimeType: 'video/mp4',
    });
  });

  it('rejects ordinary JPEGs and malformed embedded media', () => {
    expect(detectHonorMotionPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(detectHonorMotionPhoto(join(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      new TextEncoder().encode('HiHonor_OfflineData\0'),
      box('mdat', [1]),
    ))).toBeNull();
  });
});

describe('detectMotionPhoto', () => {
  it('returns the trailing MP4 declared by standard Google Motion Photo XMP', () => {
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const video = join(box('ftyp', [1, 2, 3, 4]), box('mdat', [5, 6]), box('moov', [7]));
    const xmp = new TextEncoder().encode(
      '<rdf:Description Camera:MotionPhoto="1">'
      + '<Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/>'
      + `<Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${video.length}"/>`
      + '</rdf:Description>',
    );
    const bytes = join(cover, xmp, video);

    expect(detectMotionPhoto(bytes)).toEqual({
      videoOffset: cover.length + xmp.length,
      videoLength: video.length,
      mimeType: 'video/mp4',
    });
  });

  it('rejects spoofed XMP when the declared tail is not an MP4', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description Camera:MotionPhoto="1">'
      + '<Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="4"/>'
      + '</rdf:Description>',
    );
    expect(detectMotionPhoto(join(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      xmp,
      new Uint8Array([1, 2, 3, 4]),
    ))).toBeNull();
  });
});
