import dotenv from 'dotenv';
dotenv.config();
//import { createClient } from '@supabase/supabase-js';

const PORT = process.env.PORT || 5002;
const HOST = process.env.HOST || '0.0.0.0';
//const supabaseUrl = process.env.SUPABASE_URL;
//const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

//const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

//console.log('Supabase URL:', supabaseUrl);

// socket IO allows us to set up web sockets
// these connect to the sever, and leaves the connection to the server open
// this allows for real time communication between the server and the client

// load server
import express, { json } from "express";
// load cors
import cors from "cors";
import { createServer } from "http"; 
import { Server } from "socket.io"; 

const app = express();

// Set up CORS for Express

app.use(
  cors({
    origin: [
      
      "https://quizmania-rose.vercel.app",
       "http://localhost:5173", 
    ],

    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
    
      "https://quizmania-rose.vercel.app",
      "http://localhost:5173"
    ],

    methods: ["GET", "POST"],
    credentials: true,
  },
}); 





/*const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://quizmania-rose.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
}); */
// Set timeouts to prevent 502 errors
server.keepAliveTimeout = 120000; // 120 seconds
server.headersTimeout = 121000;//Slightly higher than keepAliveTimeout

//console.log('Supabase URL:', supabaseUrl);


// In-memory cache for questions
let cachedQuestions = null;
const CACHE_DURATION = 60 * 60 * 1000; // Cache for 1 hour

// Function to fetch questions from OpenTDB
async function fetchQuestions(amount = 10, category = null, difficulty = null, type = "multiple") {
  try {
    let url = `https://opentdb.com/api.php?amount=${amount}&type=${type}`;
    if (category) url += `&category=${category}`;
    if (difficulty) url += `&difficulty=${difficulty}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      throw new Error("No questions returned from OpenTDB");
    }
    return data.results;
  } catch (error) {
    console.error("Error fetching questions:", error);
    throw error;
  }
}
app.get("/", (req, res) => {
  res.status(200).json({ message: "QuizMania Backend Server is running!" });
});

// Test API Route
app.get("/api/questions", async (req, res) => {
  try {
    // Check if questions are cached and not expired
    if (cachedQuestions && Date.now() - cachedQuestions.timestamp < CACHE_DURATION) {
      console.log("Serving questions from cache for /api/questions");
      return res.json(cachedQuestions.data);
    }

    // Fetch new questions if cache is empty or expired
    console.log("Fetching new questions from OpenTDB for /api/questions");
    const questions = await fetchQuestions(10, null, null, "multiple");
    cachedQuestions = {
      data: questions,
      timestamp: Date.now(),
    };
    res.json(questions);
  } catch (error) {
    console.error("Error in /api/questions:", error);
    res.status(500).json({ message: "Server Error: Failed to fetch questions" });
  }
});

// TRACKS USERS GLOBALLY AND SEND UPDATES
const users = {};

// TRACK USER SCORES GLOBALLY AND SEND UPDATES
const userScores = {};

// Create HTTP server and intergrate socket.io
//import { createServer } from "http";


// Socket.io connection, runs every time a client connects to our server, giving a socket instance for each one
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Add a new user to the users object when connected
  users[socket.id] = { id: socket.id, name: "", score: 0 };

  // Send updated user list to all clients
  io.emit("update-users", Object.values(users));

  // Listen for a message from the client
  socket.on("message", (data) => {
    console.log("Message received on server:", data);
    // Send the message to all clients
    socket.broadcast.emit("receive-message", data);
  });

  // listen for users setting their username
  socket.on("rename-user", (newName) => {
    if (users[socket.id]) {
      users[socket.id].name = newName;
      io.emit("update-users", Object.values(users));
    }
  });

  // Listen for the start game event
  // Makes a request to the API for questions
  // Sends the questions to all clients
  socket.on("start-game", async () => {
    console.log("Start game event received");
    try {
      const response = await fetch(
        "https://opentdb.com/api.php?amount=10&category=9&difficulty=medium&type=multiple"
      );
      const data = await response.json();

      const questions = data.results.map((question) => ({
        ...question,
        shuffledAnswers: shuffleArray([
          question.correct_answer,
          ...question.incorrect_answers,
        ]),
      }));

      // Log number of questions
      console.log("Number of Questions:", questions.length);

      // send notification to navigate to quiz page
      io.emit("navigate-to-quiz");

      // send questions data in a separate event
      setTimeout(() => {
        io.emit("quiz-questions", questions);
        console.log("emitted quiz-questions event");
      }, 500); // small delay to ensure navigation happens first
    } catch (error) {
      console.error("Error fetching quiz data:", error);
    }
  });

  // Add this handler for answer submissions
  socket.on("submit-answer", (data) => {
    const { isCorrect } = data;

    // Make sure the user exists
    if (users[socket.id]) {
      // Increment score if answer is correct
      if (isCorrect) {
        // Initialize score if it doesn't exist
        if (users[socket.id].score === undefined) {
          users[socket.id].score = 0;
        }
        users[socket.id].score += 1;
      }

      // Create and broadcast scoreboard
      broadcastScoreboard();
    }
  });

  // Listen for requests for final scores
  socket.on("request-final-scores", () => {
    console.log("Final scores requested by:", socket.id);
    broadcastScoreboard();
  });

  // handler for resetting scores
  socket.on("reset-scores", () => {
    console.log("resetting scores for all users");

    // reset all user scores to 0
    Object.keys(users).forEach((userId) => {
      if (users[userId]) {
        users[userId].score = 0;
      }
    });

    // broadcast updated scoreboard
    broadcastScoreboard();
  });

  // Helper function to broadcast updated scoreboard to all clients
  function broadcastScoreboard() {
    // create array of users with scores, sorted by score (highest first)

    const scoreboard = Object.values(users)
      .map((user) => ({
        id: user.id,
        name: user.name || `Player ${user.id.substring(0, 4)}`,
        score: user.score || 0,
        rank: 0,
      }))
      .sort((a, b) => b.score - a.score);

    // add rank property
    scoreboard.forEach((user, index) => {
      user.rank = index + 1;
    });

    // debugging
    console.log("Broadcasting scoreboard:", scoreboard);

    // finally broadcast scoreboard to all clients
    io.emit("scoreboard-update", scoreboard);
  }

  // Shuffle the answers for the questions
  function shuffleArray(array) {
    return array.sort(() => Math.random() - 0.5);
  }

  // HANDLE USERS DISCONNECTING
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // remove the user
    delete users[socket.id];
    // also remove user scores
    delete userScores[socket.id];
    // send updated user list to all clients
    io.emit("update-users", Object.values(users));
    // and update the scoreboard upon disconnect too
    broadcastScoreboard();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
