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

/**
 * GET /current
 * Returns the current and longest streak for a given activity type.
 * Query: ?activityType=meditation (required)
 */
router.get('/current', auth, async (req, res) => {
  try {
    const { activityType } = req.query;

    if (!activityType) {
      return res.status(400).json({ error: 'activityType query parameter is required' });
    }

    const { data, error } = await supabase
      .from('streak_entries')
      .select('date')
      .eq('user_id', req.userId)
      .eq('activity_type', activityType)
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase streaks current error:', error);
      return res.status(500).json({ error: 'Failed to fetch streak entries' });
    }

    if (!data || data.length === 0) {
      return res.json({ currentStreak: 0, longestStreak: 0, activityType });
    }

    // Extract unique dates
    const uniqueDates = [...new Set(data.map(d => d.date))].sort((a, b) => new Date(b) - new Date(a));
    
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Check if the streak is still active (logged today or yesterday)
    let isStreakActive = uniqueDates.length > 0 && 
                        (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr);

    if (isStreakActive) {
      currentStreak = 1;
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const d1 = new Date(uniqueDates[i]);
        const d2 = new Date(uniqueDates[i+1]);
        const diffTime = Math.abs(d1 - d2);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        if (diffDays === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    if (uniqueDates.length > 0) {
      tempStreak = 1;
      longestStreak = 1;
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const d1 = new Date(uniqueDates[i]);
        const d2 = new Date(uniqueDates[i+1]);
        const diffTime = Math.abs(d1 - d2);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        if (diffDays === 1) {
          tempStreak++;
          if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
          }
        } else {
          tempStreak = 1;
        }
      }
    }

    return res.json({ currentStreak, longestStreak, activityType });
  } catch (error) {
    console.error('Streaks current error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
