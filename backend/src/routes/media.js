const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { authenticate, authenticateUserOrLiveBroadcast } = require('../middleware/auth');
const { canAccessAlertMedia, getAlertOwnerId } = require('../utils/alertAccess');

const router = express.Router({ mergeParams: true });
const mediaRoot = process.env.VERCEL
  ? '/tmp/sos-media'
  : path.join(__dirname, '../../data/sos-media');

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(mediaRoot, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const seq = String(parseInt(req.body.sequence, 10) || Date.now()).padStart(6, '0');
      const ext = file.mimetype?.includes('mp4') ? '.mp4' : '.webm';
      cb(null, `${seq}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok =
      !file.mimetype
      || file.mimetype.startsWith('video/')
      || file.mimetype.startsWith('audio/')
      || file.mimetype === 'application/octet-stream';
    if (ok) cb(null, true);
    else cb(new Error('Only video or audio uploads are allowed'));
  },
});

function contentTypeForPath(filePath, mediaType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return mediaType === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (ext === '.webm') return mediaType === 'audio' ? 'audio/webm' : 'video/webm';
  if (mediaType === 'audio') return 'audio/webm';
  return 'video/webm';
}

router.post('/:id/media', authenticateUserOrLiveBroadcast, (req, res) => {
  upload.single('chunk')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No media chunk received' });
    }

    try {
      const alertRow = await getAlertOwnerId(req.params.id);
      if (!alertRow) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Alert not found' });
      }
      if (alertRow.status !== 'active') {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Alert is no longer active' });
      }

      const isLiveToken = req.user.liveBroadcast && req.user.alertId === req.params.id;
      const isOwner = req.user.userId === alertRow.user_id;
      if (!isOwner && !isLiveToken) {
        fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'Not allowed to upload media for this alert' });
      }

      const sequence = parseInt(req.body.sequence, 10) || 0;
      const mediaType = req.body.mediaType || 'audiovideo';
      const chunkId = randomUUID();

      await pool.query(
        `INSERT INTO sos_media_chunks
           (id, alert_id, user_id, sequence, media_type, file_path, file_size, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          chunkId,
          req.params.id,
          alertRow.user_id,
          sequence,
          mediaType,
          req.file.path,
          req.file.size,
          parseInt(req.body.durationMs, 10) || null,
        ]
      );

      res.status(201).json({
        chunk: {
          id: chunkId,
          sequence,
          mediaType,
          size: req.file.size,
          url: `/api/v1/emergency/${req.params.id}/media/${chunkId}`,
        },
      });
    } catch (uploadErr) {
      console.error('SOS media upload error:', uploadErr);
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Failed to store media chunk' });
    }
  });
});

router.get('/:id/media', authenticate, async (req, res) => {
  try {
    const access = await canAccessAlertMedia(req.user.userId, req.params.id);
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT id, sequence, media_type, file_size, duration_ms, created_at
       FROM sos_media_chunks
       WHERE alert_id = $1
       ORDER BY sequence ASC, created_at ASC`,
      [req.params.id]
    );

    res.json({
      alertId: req.params.id,
      status: access.status,
      isContactView: Boolean(access.isContact),
      chunks: result.rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        mediaType: row.media_type,
        size: row.file_size,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
        url: `/api/v1/emergency/${req.params.id}/media/${row.id}`,
      })),
    });
  } catch (err) {
    console.error('List SOS media error:', err);
    res.status(500).json({ error: 'Failed to list media' });
  }
});

router.get('/:id/media/:chunkId', authenticate, async (req, res) => {
  try {
    const access = await canAccessAlertMedia(req.user.userId, req.params.id);
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT file_path, media_type, file_size FROM sos_media_chunks
       WHERE id = $1 AND alert_id = $2`,
      [req.params.chunkId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media chunk not found' });
    }

    const row = result.rows[0];
    if (!fs.existsSync(row.file_path)) {
      return res.status(404).json({ error: 'Media file missing' });
    }

    res.setHeader('Content-Type', contentTypeForPath(row.file_path, row.media_type));
    res.setHeader('Content-Length', row.file_size);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(row.file_path).pipe(res);
  } catch (err) {
    console.error('Stream SOS media error:', err);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

module.exports = router;
