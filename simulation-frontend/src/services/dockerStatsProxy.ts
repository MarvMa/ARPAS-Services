import express from 'express';
import {exec} from 'child_process';
import {promisify} from 'util';

const execAsync = promisify(exec);

const app = express();

app.get('/api/docker/stats', async (req, res) => {
    try {
        // Get container stats using docker stats command
        const {stdout} = await execAsync('docker stats --no-stream --format "json"');
        const lines = stdout.trim().split('\n');
        const stats: any = {};

        for (const line of lines) {
            try {
                const containerStats = JSON.parse(line);
                const name = containerStats.Name || containerStats.Container;

                // Only include relevant containers
                if (name.includes('cache-service') ||
                    name.includes('storage-service') ||
                    name.includes('prediction-service') ||
                    name.includes('redis') ||
                    name.includes('minio')) {

                    stats[name] = {
                        cpu_usage: parseFloat(containerStats.CPUPerc.replace('%', '')),
                        memory_usage: parseMemory(containerStats.MemUsage.split('/')[0]),
                        memory_limit: parseMemory(containerStats.MemUsage.split('/')[1]),
                        network_rx_bytes: parseMemory(containerStats.NetIO.split('/')[0]),
                        network_tx_bytes: parseMemory(containerStats.NetIO.split('/')[1])
                    };
                }
            } catch (e) {
                console.error('Failed to parse container stats:', e);
            }
        }

        res.json(stats);
    } catch (error) {
        console.error('Failed to get Docker stats:', error);
        res.status(500).json({error: 'Failed to get Docker stats'});
    }
});

function parseMemory(value: string): number {
    const units: any = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 * 1024,
        'GB': 1024 * 1024 * 1024,
        'KiB': 1024,
        'MiB': 1024 * 1024,
        'GiB': 1024 * 1024 * 1024
    };

    const match = value.match(/^([\d.]+)([A-Za-z]+)$/);
    if (match) {
        const num = parseFloat(match[1]);
        const unit = match[2];
        return num * (units[unit] || 1);
    }
    return 0;
}

export default app;