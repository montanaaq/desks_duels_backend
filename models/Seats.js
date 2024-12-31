// models/Seats.js

const { Model } = require('sequelize');

class Seats extends Model {
    static init(sequelize, DataTypes) {
        if (!sequelize) {
            throw new Error('Sequelize instance must be provided');
        }
        
        if (!DataTypes) {
            throw new Error('DataTypes must be provided');
        }

        return super.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            occupiedBy: {
                type: DataTypes.STRING,
                allowNull: true
            },
            status: {
                type: DataTypes.ENUM('available', 'occupied', 'dueled'),
                defaultValue: 'available'
            },
            rowNumber: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            deskNumber: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            variant: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            hasPendingDuel: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            pendingDuelInitiator: {
                type: DataTypes.STRING,
                allowNull: true
            },
            pendingDuelTarget: {
                type: DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: 'Seats',
            timestamps: true
        });
    }

    static associate(models) {
        // Safely check and set up associations
        if (models.User) {
            this.belongsTo(models.User, { 
                foreignKey: 'occupiedBy', 
                as: 'occupant' 
            });
        }

        if (models.Duel) {
            this.hasMany(models.Duel, { 
                foreignKey: 'seatId', 
                as: 'duels' 
            });
        }
    }
}

module.exports = Seats;
