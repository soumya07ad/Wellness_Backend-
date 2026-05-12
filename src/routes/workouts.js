const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');

/**
 * GET /
 * Returns workouts for the authenticated user.
 * Optional query: ?date=YYYY-MM-DD to filter by date.
 * Frontend contract: GET workouts -> ApiResponse<List<WorkoutResponse>>
 */
router.get('/', auth, async (req, res) => {
  try {
    const { date } = req.query;

    let query = supabase
      .from('workouts')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (date) {
      query = query.eq('date', date);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase workouts fetch error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch workouts' });
    }

    const workouts = (data || []).map(mapWorkoutRow);
    return res.json({ success: true, data: workouts });
  } catch (error) {
    console.error('Workouts fetch error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /
 * Logs a new workout.
 * Body: { name, type, duration, caloriesBurned, distance, intensity, notes? }
 * Frontend contract: POST workouts -> ApiResponse<WorkoutResponse>
 */
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, duration, caloriesBurned, distance, intensity, notes } = req.body;

    if (!type || typeof duration !== 'number' || typeof caloriesBurned !== 'number') {
      return res.status(400).json({ success: false, error: 'type, duration, and caloriesBurned are required' });
    }

    const workoutId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const today = new Date().toISOString().split('T')[0];

    const row = {
      id: workoutId,
      user_id: req.userId,
      name: name || type,
      type,
      duration,
      calories_burned: caloriesBurned,
      distance: distance || 0,
      intensity: intensity || 'medium',
      date: today,
      notes: notes || '',
    };

    const { data, error } = await supabase
      .from('workouts')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('Supabase workout insert error:', error);
      return res.status(500).json({ success: false, error: 'Failed to log workout' });
    }

    return res.json({ success: true, data: mapWorkoutRow(data) });
  } catch (error) {
    console.error('Workout log error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /:id
 * Deletes a workout by ID.
 * Frontend contract: DELETE workouts/{id} -> ApiResponse<Unit>
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('workouts')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase workout delete error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete workout' });
    }

    return res.json({ success: true, data: null, message: 'Workout deleted' });
  } catch (error) {
    console.error('Workout delete error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /stats
 * Returns aggregated workout statistics.
 * Frontend contract: GET workouts/stats -> ApiResponse<WorkoutStatsResponse>
 * Response shape: { totalWorkouts, totalCalories, totalDistance, totalDuration, favoriteType }
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('type, duration, calories_burned, distance')
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase workout stats error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch workout stats' });
    }

    const workouts = data || [];

    if (workouts.length === 0) {
      return res.json({
        success: true,
        data: { totalWorkouts: 0, totalCalories: 0, totalDistance: 0, totalDuration: 0, favoriteType: 'N/A' },
      });
    }

    const totalWorkouts = workouts.length;
    const totalCalories = workouts.reduce((sum, w) => sum + (w.calories_burned || 0), 0);
    const totalDistance = workouts.reduce((sum, w) => sum + (w.distance || 0), 0);
    const totalDuration = workouts.reduce((sum, w) => sum + (w.duration || 0), 0);

    // Find favorite (most common) workout type
    const typeCounts = {};
    for (const w of workouts) {
      typeCounts[w.type] = (typeCounts[w.type] || 0) + 1;
    }
    const favoriteType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return res.json({
      success: true,
      data: {
        totalWorkouts,
        totalCalories,
        totalDistance: Math.round(totalDistance * 100) / 100,
        totalDuration,
        favoriteType,
      },
    });
  } catch (error) {
    console.error('Workout stats error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /personal-records
 * Returns the user's personal best records across all workouts.
 * Frontend contract: GET workouts/personal-records -> ApiResponse<PersonalRecordsResponse>
 * Response shape: { longestWorkout, maxCaloriesBurned, longestDistance, mostIntenseWorkout }
 */
router.get('/personal-records', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('duration, calories_burned, distance, intensity')
      .eq('user_id', req.userId);

    if (error) {
      console.error('Supabase personal records error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch personal records' });
    }

    const workouts = data || [];

    if (workouts.length === 0) {
      return res.json({
        success: true,
        data: { longestWorkout: 0, maxCaloriesBurned: 0, longestDistance: 0, mostIntenseWorkout: 0 },
      });
    }

    const longestWorkout = Math.max(...workouts.map((w) => w.duration || 0));
    const maxCaloriesBurned = Math.max(...workouts.map((w) => w.calories_burned || 0));
    const longestDistance = Math.max(...workouts.map((w) => w.distance || 0));
    const mostIntenseWorkout = workouts.filter((w) => w.intensity === 'high').length;

    return res.json({
      success: true,
      data: {
        longestWorkout,
        maxCaloriesBurned,
        longestDistance: Math.round(longestDistance * 100) / 100,
        mostIntenseWorkout,
      },
    });
  } catch (error) {
    console.error('Personal records error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Map a database row to the frontend WorkoutResponse shape.
 */
function mapWorkoutRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    duration: row.duration,
    caloriesBurned: row.calories_burned,
    distance: row.distance,
    intensity: row.intensity,
    date: row.date,
    notes: row.notes || '',
    heartRateData: null,
  };
}

module.exports = router;
