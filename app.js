// app.js

const { sequelize } = require('./db');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { scheduleSeatReset } = require('./services/seatResetService');
const { initializeSeats } = require('./services/initializeSeats');
const { User } = require('./models'); // Import models from models/index.js
const DuelService = require('./services/duelService');
const DuelTimeoutService = require('./services/DuelTimeoutService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000; // Use an environment variable for flexibility

// Import route handlers
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const seatsRouter = require('./routes/seats');
const duelsRouter = require('./routes/duels');
const authRoutes = require('./routes/authRoutes');

// Middleware configuration
app.use(cors());
app.use(express.json());

// Initialize HTTP and WebSocket servers
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Adjust origin as needed for security
        methods: ['GET', 'POST']
    }
});

app.get('/health-check', (req, res) => {
    res.status(200).send('OK');
  });
  

// Socket.io connection event handling
io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle user joining their room
    socket.on('join', async (telegramId) => {
        try {
            if (!telegramId) {
                socket.emit('error', { message: 'User ID is required to join a room.' });
                return;
            }
            const user = await User.findOne({ where: { telegramId } });
            if (user) {
                socket.join(telegramId); // Join room named after telegramId
                console.log(`User ${telegramId} joined room ${telegramId}`);
            } else {
                console.error(`User with telegramId ${telegramId} not found.`);
                socket.emit('error', { message: 'User not found.' });
            }
        } catch (error) {
            console.error(`Error joining room for user ${telegramId}:`, error);
            socket.emit('error', { message: 'Failed to join room.' });
        }
    });

    // Handle duel request via Socket.IO
    socket.on("duelRequest", async (data) => {
        try {
            const { challengerId, challengedId, seatId, challengerName, challengedName } = data;

            // Validate data
            if (!challengerId || !challengedId || !seatId || !challengerName || !challengedName) {
                socket.emit('error', { message: 'Invalid duel request data.' });
                return;
            }

            // Create duel using DuelService
            const duel = await DuelService.requestDuel(challengerId, challengedId, seatId);

            // Notify the challenged player about the duel request
            io.to(challengedId).emit("duelRequest", {
                duelId: duel.id, // 'id' is the primary key
                challengerId: duel.player1,
                challengedId: duel.player2,
                seatId: duel.seatId,
                challengerName,
                challengedName,
            });

            // Optionally, notify the challenger that the request was sent
            io.to(challengerId).emit("duelRequestSent", { duelId: duel.id, challengedId, seatId });

            console.log(`Duel requested: ID=${duel.id}, Challenger=${challengerId}, Challenged=${challengedId}, Seat=${seatId}`);
        } catch (error) {
            console.error("Error handling duelRequest:", error);
            socket.emit('error', { message: error.message || 'Failed to create duel request.' });
        }
    });

    // Handle duel acceptance via Socket.IO
    socket.on("acceptDuel", async (data) => {
        try {
          const { duelId } = data;
      
          if (typeof duelId !== "number") {
            socket.emit("error", { message: "Invalid duel ID." });
            return;
          }
      
          const duel = await DuelService.acceptDuel(duelId);
      
          io.to(duel.player1).emit("showDuelRoles", {
            roleMessage: "Вы 'Орёл' в этой дуэли!",
            request: {
              duelId: duel.id,
              challengerId: duel.player1,
              challengedId: duel.player2,
            },
          });
      
          io.to(duel.player2).emit("showDuelRoles", {
            roleMessage: "Вы 'Решка' в этой дуэли!",
            request: {
              duelId: duel.id,
              challengerId: duel.player1,
              challengedId: duel.player2,
            },
          });
        } catch (error) {
          console.error("Error handling acceptDuel:", error);
          socket.emit("error", { message: error.message || "Failed to accept duel." });
        }
      });

    // Handle duel decline via Socket.IO
    socket.on("declineDuel", async (data) => {
        try {
            const { duelId } = data;

            // Validate duelId
            if (typeof duelId !== 'number') {
                socket.emit('error', { message: 'Invalid duel ID.' });
                return;
            }

            // Decline duel using DuelService
            const duel = await DuelService.declineDuel(duelId);

            // Notify the challenger that the duel was declined
            io.to(duel.player1).emit("duelDeclined", {
                duelId: duel.id,
                challengedId: duel.player2,
            });

            console.log(`Duel declined: ID=${duel.id}, Challenger=${duel.player1}, Challenged=${duel.player2}`);
        } catch (error) {
            console.error("Error handling declineDuel:", error);
            socket.emit('error', { message: error.message || 'Failed to decline duel.' });
        }
    });

    // Handle disconnect
    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
        // Optionally handle cleanup if necessary
    });
});

// Route configuration
app.use('/', indexRouter);
app.use('/auth', authRoutes);
app.use('/users', usersRouter);
app.use('/seats', seatsRouter);
app.use('/duels', duelsRouter);

DuelTimeoutService.start();

// Sync database and start server
sequelize.sync()
    .then(async () => {
        await initializeSeats(); // Initialize seats
        scheduleSeatReset(); // Start seat reset schedule
        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch(error => console.error('Error syncing database:', error));
