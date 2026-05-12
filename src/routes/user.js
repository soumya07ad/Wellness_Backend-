const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * GET /profile
 * Returns the user's profile.
 * Frontend contract: GET users/profile -> ApiResponse<UserProfile>
 */
router.get('/profile', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = "no rows returned" — not a real error, just means no profile yet
      console.error('Supabase profile fetch error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }

    if (!data) {
      // Return a default profile shell for new users
      return res.json({
        success: true,
        data: {
          id: req.userId,
          name: '',
          email: '',
          phoneNumber: '',
          age: 0,
          weight: 0,
          height: 0,
          gender: '',
          profilePicture: '',
          createdAt: new Date().toISOString(),
        },
      });
    }

    return res.json({
      success: true,
      data: {
        id: data.user_id,
        name: data.name || '',
        email: data.email || '',
        phoneNumber: '',
        age: data.age || 0,
        weight: data.weight || 0,
        height: data.height || 0,
        gender: data.gender || '',
        profilePicture: '',
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /profile
 * Creates or updates the user's profile.
 * Body: { name, email, age, weight, height, gender }
 * Frontend contract: PUT users/profile -> ApiResponse<UserProfile>
 */
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, email, age, weight, height, gender } = req.body;

    const row = {
      user_id: req.userId,
      name: name || '',
      email: email || '',
      age: age || null,
      weight: weight || null,
      height: height || null,
      gender: gender || '',
    };

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('Supabase profile upsert error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }

    return res.json({
      success: true,
      data: {
        id: data.user_id,
        name: data.name || '',
        email: data.email || '',
        phoneNumber: '',
        age: data.age || 0,
        weight: data.weight || 0,
        height: data.height || 0,
        gender: data.gender || '',
        profilePicture: '',
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /preferences
 * Returns the user's app preferences.
 * Frontend contract: GET users/preferences -> ApiResponse<UserPreferencesResponse>
 */
router.get('/preferences', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Supabase preferences fetch error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
    }

    if (!data) {
      // Return defaults for new users
      return res.json({
        success: true,
        data: {
          theme: 'light',
          units: 'metric',
          dailyStepGoal: 10000,
          dailyCalorieGoal: 750,
          notificationsEnabled: true,
          syncInterval: 15,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        theme: data.theme,
        units: data.units,
        dailyStepGoal: data.daily_step_goal,
        dailyCalorieGoal: data.daily_calorie_goal,
        notificationsEnabled: data.notifications_enabled,
        syncInterval: data.sync_interval,
      },
    });
  } catch (error) {
    console.error('Preferences fetch error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /preferences
 * Creates or updates the user's app preferences.
 * Body: { theme, units, dailyStepGoal, dailyCalorieGoal, notificationsEnabled, syncInterval }
 * Frontend contract: PUT users/preferences -> ApiResponse<UserPreferencesResponse>
 */
router.put('/preferences', auth, async (req, res) => {
  try {
    const { theme, units, dailyStepGoal, dailyCalorieGoal, notificationsEnabled, syncInterval } = req.body;

    const row = {
      user_id: req.userId,
      theme: theme || 'light',
      units: units || 'metric',
      daily_step_goal: dailyStepGoal ?? 10000,
      daily_calorie_goal: dailyCalorieGoal ?? 750,
      notifications_enabled: notificationsEnabled ?? true,
      sync_interval: syncInterval ?? 15,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('Supabase preferences upsert error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update preferences' });
    }

    return res.json({
      success: true,
      data: {
        theme: data.theme,
        units: data.units,
        dailyStepGoal: data.daily_step_goal,
        dailyCalorieGoal: data.daily_calorie_goal,
        notificationsEnabled: data.notifications_enabled,
        syncInterval: data.sync_interval,
      },
    });
  } catch (error) {
    console.error('Preferences update error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
