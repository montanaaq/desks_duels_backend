// db.js

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Настройка подключения к SQLite
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite', // Путь к файлу базы данных
    define: {
        freezeTableName: true, // Убирает автоматическое добавление 's' к имени таблицы
        timestamps: true       // Включаем временные метки
    },
    logging: false,  // Disable logging
    dialectOptions: {
        // SQLite connection options
        timeout: 15000, // Timeout in ms before throwing a SQLITE_BUSY error
        busyTimeout: 15000, // Time to wait for a lock to be released
    },
    pool: {
        max: 5, // Maximum number of connection in pool
        min: 0, // Minimum number of connection in pool
        acquire: 30000, // Maximum time (ms) that pool will try to get connection before throwing error
        idle: 10000 // Maximum time (ms) that a connection can be idle before being released
    },
    retry: {
        match: [/SQLITE_BUSY/],
        max: 3 // Maximum amount of tries
    }
});

// Create a context object to pass around
const dbContext = {
    sequelize,
    DataTypes,
    models: {}
};

// Функция для загрузки и инициализации моделей
const loadModels = () => {
    const modelsPath = path.join(__dirname, 'models');

    // Read all model files
    const modelFiles = fs.readdirSync(modelsPath)
        .filter(file => file.endsWith('.js') && file !== 'index.js');

    // First pass: require all model classes
    const modelClasses = modelFiles.map(file => {
        const modelPath = path.join(modelsPath, file);
        return {
            name: path.basename(file, '.js'),
            ModelClass: require(modelPath)
        };
    });

    // Second pass: initialize models
    modelClasses.forEach(({ name, ModelClass }) => {
        try {
            // Initialize the model with sequelize and DataTypes
            dbContext.models[name] = ModelClass.init(sequelize, DataTypes);
        } catch (initError) {
            console.error(`Error initializing model ${name}:`, initError);
        }
    });

    // Third pass: set up associations
    modelClasses.forEach(({ name, ModelClass }) => {
        if (typeof ModelClass.associate === 'function') {
            try {
                ModelClass.associate(dbContext.models);
            } catch (associationError) {
                console.error(`Error setting up associations for ${name}:`, associationError);
            }
        }
    });

    return dbContext.models;
};

// Синхронизация моделей с базой данных
const syncDatabase = async () => {
    try {
        // Load and initialize models
        loadModels();
        
        // Sync all models with force: false to preserve data
        await sequelize.sync({ 
            force: false,  // Do not drop existing tables
            alter: {
                drop: false  // Prevent dropping columns
            }
        });
        
        return dbContext.models;
    } catch (error) {
        console.error('Error synchronizing database:', error);
        throw error;
    }
};

// Initialize database connection
const initializeDatabaseConnection = async () => {
    try {
        await syncDatabase();
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
};

// Call initialization
initializeDatabaseConnection();

// Export everything
module.exports = dbContext;