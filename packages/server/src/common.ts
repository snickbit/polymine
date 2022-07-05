import {Out} from '@snickbit/out'
import {createDeserializer, createSerializer} from 'raknet/src/transforms/serializer'
import Observer from './observer'
import Connector from './connector'

// Configuration
export const $out = new Out('polymine')

export const $config = {
	port: parseInt(process.env.POLYMINE_PORT || '19132'),
	discovery_interval: parseInt(String(process.env.POLYMINE_DISCOVERY_INTERVAL || '0')),
	ping_interval: Math.max(parseInt(String(process.env.POLYMINE_PING_INTERVAL || '1000')), 100)
}

if (!$config.port) {
	$out.fatal('No listen port specified (POLYMINE_PORT)')
}

// Mapping from container id to connector instance
export const connectors: Record<string, Connector> = {}

// Observe active docker containers
export const observer = new Observer($config.discovery_interval)

// Transform data packets
export const parser = createDeserializer(true)
export const serializer = createSerializer(true)

export function cleanServerName(server_name): string {
	return server_name.replace(/[^a-zA-Z\d_-]/g, '')
}
