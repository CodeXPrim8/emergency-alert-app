const express = require('express');
const { authenticate } = require('../middleware/auth');
const { updateUserLocation } = require('../services/nearby');

const router = express.Router();

router.post('/location', authenticate, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    await updateUserLocation(req.user.userId, latitude, longitude);

    res.json({
      message: 'Location updated',
      latitude,
      longitude,
    });
  } catch (err) {
    console.error('Location update error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

module.exports = router;
