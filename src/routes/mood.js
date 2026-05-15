const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Syncs mood entries from the Android app to Supabase.
 * Body: { entries: [ { score, message, date, timestamp } ] }
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
      if (typeof e.score !== 'number' || e.score < 1 || e.score > 10) {
        return res.status(400).json({ error: `entries[${i}].score must be a number between 1 and 10` });
      }
      if (!e.date || isNaN(Date.parse(e.date))) {
        return res.status(400).json({ error: `entries[${i}].date must be a valid date string` });
      }
    }

    const rows = entries.map((e) => ({
      user_id: req.userId,
      score: e.score,
      message: e.message,
      date: e.date,
      timestamp: e.timestamp,
    }));

    const { data, error } = await supabase
      .from('mood_entries')
      .insert(rows);

    if (error) {
      console.error('Supabase mood sync error:', error);
      return res.status(500).json({ error: 'Failed to sync mood entries' });
    }

    return res.json({ success: true, synced: rows.length });
  } catch (error) {
    console.error('Mood sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /recent
 * Returns mood entries for the last 7 days for the authenticated user.
 */
router.get('/recent', auth, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('mood_entries')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase mood recent error:', error);
      return res.status(500).json({ error: 'Failed to fetch recent mood entries' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Mood recent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

/**
 * DELETE /:id
 * Deletes a mood entry for the authenticated user.
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'id parameter is required' });
    }

    const { error } = await supabase
      .from('mood_entries')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase mood delete error:', error);
      return res.status(500).json({ error: 'Failed to delete mood entry' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Mood delete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /monthly
 * Returns mood entries for the last 30 days for the authenticated user.
 */
router.get('/monthly', auth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('mood_entries')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase mood monthly error:', error);
      return res.status(500).json({ error: 'Failed to fetch monthly mood entries' });
    }

    // Compute average mood score per day
    const dailyAverages = {};
    data.forEach((entry) => {
      if (!dailyAverages[entry.date]) {
        dailyAverages[entry.date] = { sum: 0, count: 0 };
      }
      dailyAverages[entry.date].sum += entry.score;
      dailyAverages[entry.date].count += 1;
    });

    const aggregated = Object.keys(dailyAverages).map(date => ({
      date,
      averageScore: dailyAverages[date].sum / dailyAverages[date].count
    })).sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.json(aggregated);
  } catch (error) {
    console.error('Mood monthly error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /yearly
 * Returns average mood entries per month for the last 365 days.
 */
router.get('/yearly', auth, async (req, res) => {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const { data, error } = await supabase
      .from('mood_entries')
      .select('score, date')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .gte('date', oneYearAgo.toISOString().split('T')[0]);

    if (error) {
      console.error('Supabase mood yearly error:', error);
      return res.status(500).json({ error: 'Failed to fetch yearly mood entries' });
    }

    // Compute average mood score per month
    const monthlyAverages = {};
    data.forEach((entry) => {
      const monthYear = entry.date.substring(0, 7); // YYYY-MM
      if (!monthlyAverages[monthYear]) {
        monthlyAverages[monthYear] = { sum: 0, count: 0 };
      }
      monthlyAverages[monthYear].sum += entry.score;
      monthlyAverages[monthYear].count += 1;
    });

    const aggregated = Object.keys(monthlyAverages).map(month => ({
      month,
      averageScore: monthlyAverages[month].sum / monthlyAverages[month].count
    })).sort((a, b) => b.month.localeCompare(a.month));

    return res.json(aggregated);
  } catch (error) {
    console.error('Mood yearly error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
