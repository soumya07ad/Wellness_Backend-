const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * GET /
 * Returns all paired devices for the authenticated user.
 */
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('paired_devices')
      .select('*')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('last_connected_at', { ascending: false });

    if (error) {
      console.error('Supabase paired devices get error:', error);
      return res.status(500).json({ error: 'Failed to fetch paired devices' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Paired devices get error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /
 * Registers or updates a paired device for the authenticated user.
 * Body: { macAddress, deviceName, ringType }
 */
router.post('/', auth, async (req, res) => {
  try {
    const { macAddress, deviceName, ringType } = req.body;

    if (!macAddress || typeof macAddress !== 'string' || macAddress.trim() === '') {
      return res.status(400).json({ error: 'macAddress is required' });
    }

    // Check if device already exists
    const { data: existingDevice } = await supabase
      .from('paired_devices')
      .select('id')
      .eq('user_id', req.userId)
      .eq('mac_address', macAddress)
      .single();

    let data, error;

    if (existingDevice) {
      // Update
      const response = await supabase
        .from('paired_devices')
        .update({
          device_name: deviceName,
          ring_type: ringType,
          is_deleted: false,
          last_connected_at: new Date().toISOString()
        })
        .eq('id', existingDevice.id)
        .select();
        
      data = response.data;
      error = response.error;
    } else {
      // Insert
      const response = await supabase
        .from('paired_devices')
        .insert([{
          user_id: req.userId,
          mac_address: macAddress,
          device_name: deviceName,
          ring_type: ringType
        }])
        .select();
        
      data = response.data;
      error = response.error;
    }

    if (error) {
      console.error('Supabase paired devices post error:', error);
      return res.status(500).json({ error: 'Failed to save paired device' });
    }

    return res.json({ success: true, device: data[0] });
  } catch (error) {
    console.error('Paired devices post error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /:mac
 * Deletes a paired device for the authenticated user by its MAC address.
 */
router.delete('/:mac', auth, async (req, res) => {
  try {
    const { mac } = req.params;
    
    if (!mac) {
      return res.status(400).json({ error: 'mac parameter is required' });
    }

    const { error } = await supabase
      .from('paired_devices')
      .update({ is_deleted: true })
      .eq('mac_address', mac)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase paired devices delete error:', error);
      return res.status(500).json({ error: 'Failed to delete paired device' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Paired devices delete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
