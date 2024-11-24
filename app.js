// app.js

const { sequelize } = require('./db');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { scheduleSeatReset } = require('./services/seatResetService');
const { initializeSeats } = require('./services/initializeSeats');
const { User, Seats } = require('./models');
const DuelService = require('./services/duelService');
const DuelTimeoutService = require('./services/DuelTimeoutService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const seatsRouter = require('./routes/seats');
const duelsRouter = require('./routes/duels');
const authRoutes = require('./routes/authRoutes');

app.use(cors());
app.use(express.json());

// Создание HTTP и WebSocket серверов
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.get('/health-check', (req, res) => {
  res.status(200).send('OK');
});

// Уведомление об обновлении статуса места
const updateSeatStatus = async (seatId) => {
  try {
    const updatedSeat = await Seats.findByPk(seatId);
    if (updatedSeat) {
      const seats = await Seats.findAll();
      io.emit("seatsUpdated", seats);
    }
  } catch (error) {
    console.error("Error emitting seatUpdated event:", error);
  }
};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send initial seats data when client connects
  socket.on('requestInitialSeats', async () => {
    try {
      console.log('Received requestInitialSeats from client:', socket.id);
      const seats = await Seats.findAll();
      console.log('Sending initial seats data:', seats);
      socket.emit('seatsUpdated', seats);
    } catch (error) {
      console.error('Error sending initial seats:', error);
    }
  });

  socket.on('join', async (telegramId) => {
    try {
      if (!telegramId) {
        socket.emit('error', { message: 'User ID is required to join a room.' });
        return;
      }
      const user = await User.findOne({ where: { telegramId } });
      if (user) {
        socket.join(telegramId);
        console.log(`User ${telegramId} joined room ${telegramId}`);
      } else {
        socket.emit('error', { message: 'User not found.' });
      }
    } catch (error) {
      socket.emit('error', { message: 'Failed to join room.' });
    }
  });

  socket.on('updateSeat', async (data) => {
    try {
      console.log('Received updateSeat event:', data);
      const { seatId, userId } = data;

      if (!seatId || !userId) {
        console.log('Missing seatId or userId:', { seatId, userId });
        socket.emit('error', { message: 'Seat ID and User ID are required.' });
        return;
      }

      // Find and clear the user's previous seat if exists
      const previousSeat = await Seats.findOne({ where: { occupiedBy: userId } });
      if (previousSeat) {
        previousSeat.occupiedBy = null;
        await previousSeat.save();
      }

      // Update the new seat in the database
      const seat = await Seats.findOne({ where: { id: seatId } });
      if (!seat) {
        console.log('Seat not found:', seatId);
        socket.emit('error', { message: 'Seat not found.' });
        return;
      }

      if (seat.occupiedBy) {
        console.log('Seat already occupied:', { seatId, currentOccupant: seat.occupiedBy });
        socket.emit('error', { message: 'Seat is already occupied.' });
        return;
      }

      // Update seat status
      seat.occupiedBy = userId;
      await seat.save();

      // Get all seats and broadcast the update
      const seats = await Seats.findAll();
      console.log('Broadcasting updated seats to all clients:', seats);
      io.emit('seatsUpdated', seats);

      console.log(`Seat ${seatId} successfully occupied by user ${userId}, previous seat cleared`);
    } catch (error) {
      console.error('Error updating seat:', error);
      socket.emit('error', { message: 'Failed to update seat.' });
    }
  });

  socket.on("duelRequest", async (data) => {
    try {
      const { challengerId, challengedId, seatId, challengerName, challengedName } = data;

      if (!challengerId || !challengedId || !seatId || !challengerName || !challengedName) {
        socket.emit('error', { message: 'Invalid duel request data.' });
        return;
      }

      const duel = await DuelService.requestDuel(challengerId, challengedId, seatId);

      io.to(challengedId).emit("duelRequest", {
        duelId: duel.id,
        challengerId: duel.player1,
        challengedId: duel.player2,
        seatId: duel.seatId,
        challengerName,
        challengedName,
      });

      io.to(challengerId).emit("duelRequestSent", { duelId: duel.id, challengedId, seatId });
    } catch (error) {
      socket.emit('error', { message: error.message || 'Failed to create duel request.' });
    }
  });

  socket.on("acceptDuel", async (data) => {
    try {
      const { duelId } = data;

      if (!duelId) {
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
      socket.emit("error", { message: error.message || "Failed to accept duel." });
    }
  });

  socket.on("declineDuel", async (data) => {
    try {
      const { duelId } = data;

      if (!duelId) {
        socket.emit('error', { message: 'Invalid duel ID.' });
        return;
      }

      const duel = await DuelService.declineDuel(duelId);

      io.to(duel.player1).emit("duelDeclined", {
        duelId: duel.id,
        challengedId: duel.player2,
      });
    } catch (error) {
      socket.emit('error', { message: error.message || 'Failed to decline duel.' });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

app.use('/', indexRouter);
app.use('/auth', authRoutes);
app.use('/users', usersRouter);
app.use('/seats', seatsRouter);
app.use('/duels', duelsRouter);

DuelTimeoutService.start();

sequelize.sync()
  .then(async () => {
    DuelService.initTimeoutCheck();
    await initializeSeats();
    scheduleSeatReset();
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(error => console.error('Error syncing database:', error));
