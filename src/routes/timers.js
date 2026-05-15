const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * GET /
 * Returns all saved timers for the user.
 * Frontend contract: GET timers -> ApiResponse<List<TimerResponse>>
 */
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('timers')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase timers fetch error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch timers' });
    }

    const timers = (data || []).map(mapTimerRow);
    return res.json({ success: true, data: timers });
  } catch (error) {
    console.error('Timers fetch error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /
 * Creates a new timer.
 * Body: { id, name, totalSeconds, type }
 * Frontend contract: POST timers -> ApiResponse<TimerResponse>
 */
router.post('/', auth, async (req, res) => {
  try {
    const { id, name, totalSeconds, type } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (typeof totalSeconds !== 'number' || totalSeconds <= 0) {
      return res.status(400).json({ success: false, error: 'totalSeconds must be a positive number' });
    }

    const timerId = id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const row = {
      id: timerId,
      user_id: req.userId,
      name: name.trim(),
      total_seconds: totalSeconds,
      type: type || 'custom',
    };

    const { data, error } = await supabase
      .from('timers')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Supabase timer insert error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create timer' });
    }

    return res.json({ success: true, data: mapTimerRow(data) });
  } catch (error) {
    console.error('Timer create error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /:id
 * Updates an existing timer.
 * Body: { name, totalSeconds, type }
 * Frontend contract: PUT timers/{id} -> ApiResponse<TimerResponse>
 */
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, totalSeconds, type } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (totalSeconds !== undefined) updates.total_seconds = totalSeconds;
    if (type !== undefined) updates.type = type;

    const { data, error } = await supabase
      .from('timers')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) {
      console.error('Supabase timer update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update timer' });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Timer not found' });
    }

    return res.json({ success: true, data: mapTimerRow(data) });
  } catch (error) {
    console.error('Timer update error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /:id
 * Deletes a timer.
 * Frontend contract: DELETE timers/{id} -> ApiResponse<Unit>
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('timers')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase timer delete error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete timer' });
    }

    return res.json({ success: true, data: null, message: 'Timer deleted' });
  } catch (error) {
    console.error('Timer delete error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Map a database row to the frontend TimerResponse shape.
 */
function mapTimerRow(row) {
  return {
    id: row.id,
    name: row.name,
    totalSeconds: row.total_seconds,
    remainingSeconds: row.total_seconds,
    isRunning: false,
    type: row.type,
  };
}

module.exports = router;
