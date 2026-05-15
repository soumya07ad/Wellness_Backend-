const express = require('express');
const router = express.Router();
const supabase = require('../db/supabase');
const auth = require('../middleware/auth');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

// Initialize Gemini client (lazy — only used when /chat is called)
let genAI;
function getGenAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

const promptPath = path.join(__dirname, '..', 'prompts', 'aura_system_prompt.md');
const SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf8');

/**
 * GET /history
 * Returns all coach sessions and their messages for the authenticated user.
 * Response: { success: true, data: { sessions: [...] } }
 */
router.get('/history', auth, async (req, res) => {
  try {
    // Fetch all sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('coach_sessions')
      .select('id, created_at')
      .eq('user_id', req.userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (sessionsError) {
      console.error('Supabase coach sessions error:', sessionsError);
      return res.status(500).json({ error: 'Failed to fetch coach sessions' });
    }

    if (!sessions || sessions.length === 0) {
      return res.json({ success: true, data: { sessions: [] } });
    }

    // Fetch messages for all sessions
    const sessionIds = sessions.map((s) => s.id);
    const { data: messages, error: messagesError } = await supabase
      .from('coach_messages')
      .select('id, session_id, text, is_user, timestamp')
      .in('session_id', sessionIds)
      .order('timestamp', { ascending: true });

    if (messagesError) {
      console.error('Supabase coach messages error:', messagesError);
      return res.status(500).json({ error: 'Failed to fetch coach messages' });
    }

    // Group messages by session
    const messagesBySession = {};
    for (const msg of messages || []) {
      if (!messagesBySession[msg.session_id]) {
        messagesBySession[msg.session_id] = [];
      }
      messagesBySession[msg.session_id].push({
        id: msg.id,
        text: msg.text,
        isUser: msg.is_user,
        timestamp: msg.timestamp,
      });
    }

    const result = sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      messages: messagesBySession[s.id] || [],
    }));

    return res.json({ success: true, data: { sessions: result } });
  } catch (error) {
    console.error('Coach history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /chat
 * Sends a user message, generates an AI response via Gemini, and saves both.
 * Body: { message: string, sessionId?: string }
 * Response: { success: true, data: { sessionId, response } }
 */
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'message is required and must be a non-empty string' });
    }

    let activeSessionId = sessionId;

    // Create a new session if none provided
    if (!activeSessionId) {
      const { data: newSession, error: sessionError } = await supabase
        .from('coach_sessions')
        .insert({ user_id: req.userId })
        .select('id')
        .single();

      if (sessionError) {
        console.error('Create session error:', sessionError);
        return res.status(500).json({ error: 'Failed to create coach session' });
      }
      activeSessionId = newSession.id;
    }

    // Save user message
    const { error: userMsgError } = await supabase
      .from('coach_messages')
      .insert({
        session_id: activeSessionId,
        user_id: req.userId,
        text: message.trim(),
        is_user: true,
      });

    if (userMsgError) {
      console.error('Save user message error:', userMsgError);
      return res.status(500).json({ error: 'Failed to save user message' });
    }

    // Fetch conversation history for context
    const { data: history } = await supabase
      .from('coach_messages')
      .select('text, is_user')
      .eq('session_id', activeSessionId)
      .order('timestamp', { ascending: true })
      .limit(20);

    // Build conversation context for Gemini
    const conversationContext = (history || [])
      .map((m) => `${m.is_user ? 'User' : 'AURA'}: ${m.text}`)
      .join('\n');

    const prompt = `${SYSTEM_PROMPT}\n\nConversation so far:\n${conversationContext}\n\nRespond as AURA:`;

    // Call Gemini API
    let responseText;
    try {
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });
      responseText = response.text || 'I apologize, I was unable to generate a response. Please try again.';
    } catch (aiError) {
      console.error('Gemini API error:', aiError);
      responseText = 'I\'m having trouble connecting right now. Please try again in a moment.';
    }

    // Save AI response
    const { error: aiMsgError } = await supabase
      .from('coach_messages')
      .insert({
        session_id: activeSessionId,
        user_id: req.userId,
        text: responseText,
        is_user: false,
      });

    if (aiMsgError) {
      console.error('Save AI message error:', aiMsgError);
    }

    return res.json({
      success: true,
      data: {
        sessionId: activeSessionId,
        response: responseText,
      },
    });
  } catch (error) {
    console.error('Coach chat error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /session/:id
 * Deletes a coach session and all its messages.
 */
router.delete('/session/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user
    const { data: session, error: fetchError } = await supabase
      .from('coach_sessions')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (fetchError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Soft Delete session (messages will remain but be orphaned)
    const { error: deleteError } = await supabase
      .from('coach_sessions')
      .update({ is_deleted: true })
      .eq('id', id);

    if (deleteError) {
      console.error('Delete session error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete session' });
    }

    return res.json({ success: true, message: 'Session deleted' });
  } catch (error) {
    console.error('Coach delete session error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
