/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
goog.require('shaka.media.TimestampOffsetCorrector');
goog.require('shaka.media.SegmentReference');
goog.require('shaka.media.InitSegmentReference');
goog.require('shaka.util.ManifestParserUtils');
goog.require('shaka.test.Util');

describe('TimestampOffsetCorrector', () => {
  const initSegmentUri =
      '/base/test/test/assets/timestamp-offset-corrector-header.m4s';
  const mediaSegmentUri =
      '/base/test/test/assets/timestamp-offset-corrector-segment.m4s';

  const contentType = shaka.util.ManifestParserUtils.ContentType.AUDIO;

  /** @type {!ArrayBuffer} */
  let initSegment;
  /** @type {!ArrayBuffer} */
  let mediaSegment;

  // Actual base media decode time for the media segment
  const baseMediaDecodeTimeSec = 16628739.423377778;

  const initSegmentReference = new shaka.media.InitSegmentReference(
      () => [initSegmentUri], // uri
      0, // startByte
      null); // endByte

  const createSegmenRefWithTimestampOffset = (timestampOffset) => {
    return new shaka.media.SegmentReference(
        0, // startTime
        2, // endTime
        () => [mediaSegmentUri], // uris
        0, // startByte
        null, // endByte
        initSegmentReference, // initSegmentReference
        timestampOffset, // timestampOffset
        0, // appendWindowStart
        Infinity); // appendWindowEnd
  };

  const createStreamingConfig =
      (correctTimestampOffset, maxTimestampDiscrepancy) => {
        const config = shaka.util.PlayerConfiguration.createDefault().streaming;
        config.correctTimestampOffset = correctTimestampOffset;
        config.maxTimestampDiscrepancy = maxTimestampDiscrepancy;
        return config;
      };

  beforeAll(async () => {
    const responses = await Promise.all([
      shaka.test.Util.fetch(initSegmentUri),
      shaka.test.Util.fetch(mediaSegmentUri),
    ]);
    initSegment = responses[0];
    mediaSegment = responses[1];
  });

  describe('checkTimestampOffset()', () => {
    it('does not alter correct timestampOffset', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected =
          tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);
      expect(corrected);
      expect(segRef.timestampOffset).toBeCloseTo(
          -baseMediaDecodeTimeSec, 1);
    });

    it('corrects timestampOffset that is off by more than ' +
        'maxTimestampDiscrepancy', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 30);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected =
          tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);
      expect(corrected);
      expect(segRef.timestampOffset).toBeCloseTo(-baseMediaDecodeTimeSec, 1);
    });

    it('does not correct timestampOffset that is off by less than '
        + 'maxTimestampDiscrepancy', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 5);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected =
          tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);
      expect(corrected);
      expect(segRef.timestampOffset).toBeCloseTo(
          -baseMediaDecodeTimeSec + 5, 1);
    });

    it('returns false when timestampOffset has already been corrected', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 15);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);

      const corrected =
          tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);
      expect(corrected === false);
    });

    it('does not correct timestampOffset when disabled', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(false, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 30);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected =
          tsoc.checkTimestampOffset(contentType, segRef, mediaSegment);
      expect(corrected === false);
      expect(segRef.timestampOffset).toBeCloseTo(
          -baseMediaDecodeTimeSec + 30, 1);
    });
  });

  describe('correctTimestampOffset()', () => {
    it('updates timestampOffset in reference with same original ' +
      'timestampOffset', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 30);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected = tsoc.checkTimestampOffset(
          contentType, segRef, mediaSegment);
      expect(corrected);
      expect(segRef.timestampOffset).toBeCloseTo(-baseMediaDecodeTimeSec, 1);
      const segRef2 =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 30);
      tsoc.correctTimestampOffset(contentType, segRef2);
      expect(segRef2.timestampOffset).toBeCloseTo(-baseMediaDecodeTimeSec, 1);
    });

    it('does not update timestampOffset in reference with different ' +
      'original timestampOffset', () => {
      const tsoc = new shaka.media.TimestampOffsetCorrector();
      tsoc.configure(createStreamingConfig(true, 10));
      const segRef =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 30);
      tsoc.parseTimescalesFromInitSegment(contentType, initSegment);
      const corrected = tsoc.checkTimestampOffset(
          contentType, segRef, mediaSegment);
      expect(corrected);
      expect(segRef.timestampOffset).toBeCloseTo(-baseMediaDecodeTimeSec, 1);
      const segRef2 =
          createSegmenRefWithTimestampOffset(-baseMediaDecodeTimeSec + 40);
      tsoc.correctTimestampOffset(contentType, segRef2);
      expect(segRef2.timestampOffset)
          .toBeCloseTo(-baseMediaDecodeTimeSec + 40, 1);
    });
  });
});
