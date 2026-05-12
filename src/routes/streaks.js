const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Syncs streak entries from the Android app to Supabase.
 * Body: { entries: [ { activityType, date } ] }
 */
router.post('/sync', auth, async (req, res) => {
  try {
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required and must not be empty' });
    }

    // Validate each entry
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.activityType || typeof e.activityType !== 'string' || e.activityType.trim() === '') {
        return res.status(400).json({ error: `entries[${i}].activityType must be a non-empty string` });
      }
      if (!e.date || isNaN(Date.parse(e.date))) {
        return res.status(400).json({ error: `entries[${i}].date must be a valid date string` });
      }
    }

    const rows = entries.map((e) => ({
      user_id: req.userId,
      activity_type: e.activityType,
      date: e.date,
    }));

    const { data, error } = await supabase
      .from('streak_entries')
      .upsert(rows, { onConflict: 'user_id,activity_type,date' });

    if (error) {
      console.error('Supabase streaks sync error:', error);
      return res.status(500).json({ error: 'Failed to sync streak entries' });
    }

    return res.json({ success: true, synced: rows.length });
  } catch (error) {
    console.error('Streaks sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /by-type
 * Returns all streak entries for a given activity type for the authenticated user.
 * Query: ?activityType=meditation (required)
 */
router.get('/by-type', auth, async (req, res) => {
  try {
    const { activityType } = req.query;

    if (!activityType) {
      return res.status(400).json({ error: 'activityType query parameter is required' });
    }

    const { data, error } = await supabase
      .from('streak_entries')
      .select('*')
      .eq('user_id', req.userId)
      .eq('activity_type', activityType)
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase streaks by-type error:', error);
      return res.status(500).json({ error: 'Failed to fetch streak entries' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Streaks by-type error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
