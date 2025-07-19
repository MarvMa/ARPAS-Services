import {Sequelize, DataTypes, Model, Optional} from 'sequelize';

const dbFile = process.env.SIMULATION_DB_FILE || './data/simulation.sqlite';
export const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbFile,
    logging: console.log // Enable logging to debug database issues
});

interface ProfileAttributes {
    id: string;
    color: string;
    duration: number;
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    routeData: string;
}

interface ProfileCreationAttributes extends Optional<ProfileAttributes, 'id'> {
}

// Define the Profile model class
class ProfileModel extends Model<ProfileAttributes, ProfileCreationAttributes> implements ProfileAttributes {
    public id!: string;
    public color!: string;
    public duration!: number;
    public startLat!: number;
    public startLon!: number;
    public endLat!: number;
    public endLon!: number;
    public routeData!: string;

    // timestamps
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

ProfileModel.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    color: {
        type: DataTypes.STRING,
        allowNull: false
    },
    duration: {
        type: DataTypes.FLOAT, // store duration in seconds
        allowNull: false
    },
    startLat: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    startLon: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    endLat: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    endLon: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    routeData: {
        type: DataTypes.TEXT, // JSON string of the route points
        allowNull: false
    }
}, {
    sequelize,
    modelName: 'Profile',
    tableName: 'Profiles'
});

export const Profile = ProfileModel;