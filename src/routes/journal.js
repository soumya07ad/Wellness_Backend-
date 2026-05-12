const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * POST /sync
 * Syncs journal entries from the Android app to Supabase.
 * Body: { entries: [ { title, content, date } ] }
 * Note: Uses INSERT (not upsert) to allow multiple journal entries per day.
 */
router.post('/sync', auth, async (req, res) => {
  try {
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required and must not be empty' });
    }

    const rows = entries.map((e) => {
      const row = {
        user_id: req.userId,
        title: e.title,
        content: e.content,
        date: e.date,
      };
      if (e.id) {
        row.id = e.id;
      }
      return row;
    });

    // Use upsert to allow updates if id is provided
    const { data, error } = await supabase
      .from('journal_entries')
      .upsert(rows);

    if (error) {
      console.error('Supabase journal sync error:', error);
      return res.status(500).json({ error: 'Failed to sync journal entries' });
    }

    return res.json({ success: true, synced: rows.length });
  } catch (error) {
    console.error('Journal sync error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /recent
 * Returns journal entries for the last 7 days for the authenticated user.
 */
router.get('/recent', auth, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', req.userId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('Supabase journal recent error:', error);
      return res.status(500).json({ error: 'Failed to fetch recent journal entries' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Journal recent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

/**
 * DELETE /:id
 * Deletes a journal entry for the authenticated user.
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'id parameter is required' });
    }

    const { error } = await supabase
      .from('journal_entries')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase journal delete error:', error);
      return res.status(500).json({ error: 'Failed to delete journal entry' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Journal delete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
