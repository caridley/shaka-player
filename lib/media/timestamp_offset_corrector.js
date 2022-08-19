/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

goog.provide('shaka.media.TimestampOffsetCorrector');

goog.require('goog.asserts');
goog.require('shaka.log');
goog.require('shaka.media.SegmentReference');
goog.require('shaka.util.ManifestParserUtils');
goog.require('shaka.util.Mp4BoxParsers');
goog.require('shaka.util.Mp4Parser');


shaka.media.TimestampOffsetCorrector = class {
  /**
   * Create new instance
   */
  constructor() {
    /**
     * Maps a content type, e.g., 'audio', 'video', or 'text' to 
     * to corrected timestampOffset
     *
     * @private {!Map.<shaka.util.ManifestParserUtils.ContentType,
     *                 number>}
     */
    this.contentTypeTimestampOffsets_ = new Map();

    /**
     * @private {!Map.<shaka.util.ManifestParserUtils.ContentType,
     *                 !Map<number, number>>}
     */
    this.contentTypeTrackTimescales_ = new Map();

    /** @private {?shaka.extern.StreamingConfiguration} */
    this.config_ = null;
  }

  /**
   * Configure timestamp offset corrector
   *
   * @param {shaka.extern.StreamingConfiguration} config
   */
  configure(config) {
    this.config_ = config;
  }

  /**
   * Applies corrected timestamp offset to a segment reference
   *
   * @param {shaka.util.ManifestParserUtils.ContentType} contentType
   * @param {shaka.media.SegmentReference} reference
   */
  correctTimestampOffset(contentType, reference) {
    if (!this.config_.correctTimestampOffset) {
      return;
    }
 
    if(this.contentTypeTimestampOffsets_.has(contentType)) {
      const correctedTimestampOffset = this.contentTypeTimestampOffsets_.get(contentType);
      reference.correctTimestampOffset(correctedTimestampOffset);
      return;
    }
  }
 

  /**
   * Detects discrepancies in timestamp offset and save that info for
   * use in correctTimestampOffset
   *
   * @param {shaka.util.ManifestParserUtils.ContentType} contentType
   * @param {shaka.media.SegmentReference} reference
   * @param {BufferSource} segmentData
   * @return {boolean} true if a discrepancy was detected
   */
  checkTimestampOffset(contentType, reference, segmentData) {
    if (!this.config_.correctTimestampOffset) {
      return false;
    }

    if (reference.timestampOffsetCorrected) {
      return false;
    }

    const baseMediaDecodeTimeSec =
        this.parseBaseMediaDecodeTime_(contentType, segmentData) +
        reference.timestampOffset;
    const mediaTimeDiscrepancy =
        baseMediaDecodeTimeSec - reference.getStartTime();

    let correctedTimestampOffset = reference.timestampOffset;
    if(Math.abs(mediaTimeDiscrepancy) > this.config_.maxTimestampDiscrepancy) {
      correctedTimestampOffset = reference.timestampOffset - mediaTimeDiscrepancy;
    }

    shaka.log.debug('checkTimestampOffset() ' +
        ' contentType=' + contentType +
        ' baseMediaDecodeTime=' + baseMediaDecodeTimeSec +
        ' reference.getStartTime()=' + reference.getStartTime() +
        ' mediaTimeDiscrepancy=' + mediaTimeDiscrepancy + 
        ' originalTimestampOffset=' + reference.timestampOffset +
        ' correctedTimestampOffset=' + correctedTimestampOffset);

    reference.correctTimestampOffset(correctedTimestampOffset);

    this.contentTypeTimestampOffsets_.set(contentType, correctedTimestampOffset);
    return true;
  }

  /**
   *
   * @param {shaka.util.ManifestParserUtils.ContentType} contentType
   * @param {BufferSource} segmentData
   * @return {number} base media decode time in seconds
   * @private
   */
  parseBaseMediaDecodeTime_(contentType, segmentData) {
    const Mp4Parser = shaka.util.Mp4Parser;

    // Fields that are found in MOOF boxes
    let baseMediaDecodeTime = 0;
    let timescale = 1;

    new Mp4Parser()
        .box('moof', Mp4Parser.children)
        .box('traf', Mp4Parser.children)
        .fullBox('tfhd', (box) => {
          const parsedTFHD = shaka.util.Mp4BoxParsers.parseTFHD(
              box.reader, box.flags);

          const trackId = parsedTFHD.trackId;

          // look up timescale
          if (this.contentTypeTrackTimescales_.has(contentType)) {
            const trackTimescales =
                this.contentTypeTrackTimescales_.get(contentType);
            if (trackTimescales.has(trackId)) {
              timescale = trackTimescales.get(trackId);
            }
          }
        })
        .fullBox('tfdt', (box) => {
          const parsedTFDT = shaka.util.Mp4BoxParsers.parseTFDT(
              box.reader, box.version);

          baseMediaDecodeTime = parsedTFDT.baseMediaDecodeTime;
        })
        .parse(segmentData, /* partialOkay= */ false);

    return baseMediaDecodeTime / timescale;
  }

  /**
   *
   * @param {shaka.util.ManifestParserUtils.ContentType} contentType
   * @param {BufferSource} initSegment
   */
  parseTimescalesFromInitSegment(contentType, initSegment) {
    shaka.log.debug('getTimescalesFromInitSegment');
    if (!this.config_.correctTimestampOffset) {
      return;
    }
    this.contentTypeTimestampOffsets_.delete(contentType);
    this.contentTypeTrackTimescales_.delete(contentType);

    const Mp4Parser = shaka.util.Mp4Parser;
    const trackIds = [];
    const timescales = [];

    new Mp4Parser()
        .box('moov', Mp4Parser.children)
        .box('mvex', Mp4Parser.children)
        .box('trak', Mp4Parser.children)
        .fullBox('tkhd', (box) => {
          const parsedTKHDBox = shaka.util.Mp4BoxParsers.parseTKHD(
              box.reader, box.version);
          trackIds.push(parsedTKHDBox.trackId);
        })
        .box('mdia', Mp4Parser.children)
        .fullBox('mdhd', (box) => {
          const parsedMDHDBox = shaka.util.Mp4BoxParsers.parseMDHD(
              box.reader, box.version);
          timescales.push(parsedMDHDBox.timescale);
        })
        .parse(initSegment, /* partialOkay= */ true);

    /** @type {Map<number, number>} */
    let trackTimeScales = null;

    if (this.contentTypeTrackTimescales_.has(contentType)) {
      trackTimeScales = this.contentTypeTrackTimescales_.get(contentType);
    }
    if (!trackTimeScales) {
      trackTimeScales = new Map();
      this.contentTypeTrackTimescales_.set(contentType, trackTimeScales);
    }

    // Populate the map from track Id to timescale
    trackIds.forEach((trackId, idx) => {
      trackTimeScales.set(trackId, timescales[idx]);
    });
  }
};
