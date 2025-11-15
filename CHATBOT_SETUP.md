# AI Chatbot Setup Instructions

## Prerequisites

1. **Install Ollama**
   - Download from: https://ollama.ai/download
   - Install for Windows

2. **Install Gemma2 2B Model**
   Open a terminal and run:
   ```bash
   ollama pull gemma2:2b
   ```

3. **Start Ollama Service**
   Ollama should start automatically after installation. If not, run:
   ```bash
   ollama serve
   ```

## Verify Installation

1. Check if Ollama is running:
   ```bash
   ollama list
   ```
   You should see `gemma2:2b` in the list.

2. Test the model:
   ```bash
   ollama run gemma2:2b
   ```

## Using the Chatbot

1. Start your application:
   ```bash
   npm start
   ```

2. Login as either student or teacher

3. Click the purple chatbot icon at the bottom-right corner

4. Type your questions and get AI-powered responses!

## Features

- ✨ Beautiful gradient purple chatbot icon
- 💬 Real-time chat interface
- 🤖 Powered by Gemma2 2B running locally via Ollama
- 🔒 Works for both students and teachers
- 📱 Responsive design

## Troubleshooting

**Error: "Failed to get response"**
- Make sure Ollama is running (`ollama serve`)
- Verify the model is installed (`ollama list`)
- Check if Ollama is accessible at `http://localhost:11434`

**Model not found**
- Run: `ollama pull gemma2:2b`

**Slow responses**
- The Gemma2 2B model is lightweight but performance depends on your hardware
- Consider using a smaller model if needed: `ollama pull gemma:2b`
