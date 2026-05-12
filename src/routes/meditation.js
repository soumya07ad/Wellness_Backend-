const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Logs a completed meditation session.
 * Body: { category: string, duration: number (minutes) }
 */
router.post('/sync', auth, async (req, res) => {
  try {
    const { category, duration } = req.body;

    if (!category || typeof category !== 'string' || category.trim() === '') {
      return res.status(400).json({ error: 'category is required and must be a non-empty string' });
    }
    if (typeof duration !== 'number' || duration <= 0) {
      return res.status(400).json({ error: 'duration is required and must be a positive number (in minutes)' });
    }

    const { data, error } = await supabase
      .from('meditation_sessions')
      .insert({
        user_id: req.userId,
        category: category.trim(),
        duration,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase meditation insert error:', error);
      return res.status(500).json({ error: 'Failed to log meditation session' });
    }

    return res.json({
      success: true,
      data: {
        id: data.id,
        category: data.category,
        duration: data.duration,
        timestamp: data.timestamp,
      },
    });
  } catch (error) {
    console.error('Meditation sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /history
 * Returns meditation session history and total minutes.
 * Optional query: ?days=30 (defaults to all time)
 */
router.get('/history', auth, async (req, res) => {
  try {
    const { days } = req.query;

    let query = supabase
      .from('meditation_sessions')
      .select('*')
      .eq('user_id', req.userId)
      .order('timestamp', { ascending: false });

    if (days) {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        const since = new Date();
        since.setDate(since.getDate() - daysNum);
        query = query.gte('timestamp', since.toISOString());
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase meditation history error:', error);
      return res.status(500).json({ error: 'Failed to fetch meditation history' });
    }

    const sessions = data || [];
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalSessions = sessions.length;

    // Breakdown by category
    const byCategory = {};
    for (const s of sessions) {
      if (!byCategory[s.category]) {
        byCategory[s.category] = { sessions: 0, minutes: 0 };
      }
      byCategory[s.category].sessions++;
      byCategory[s.category].minutes += s.duration || 0;
    }

    return res.json({
      success: true,
      data: {
        totalMinutes,
        totalSessions,
        byCategory,
        sessions: sessions.map((s) => ({
          id: s.id,
          category: s.category,
          duration: s.duration,
          timestamp: s.timestamp,
        })),
      },
    });
  } catch (error) {
    console.error('Meditation history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
