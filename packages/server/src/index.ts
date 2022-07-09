#!/usr/bin/env node
import {cli} from '@snickbit/node-cli'
import {$config, $out, connectors, observer, parser, serializer} from './common'
import {beforeExit} from '@snickbit/node-utilities'
import packageJson from '../package.json'
import dgram from 'dgram'

cli()
	.name('@snickbit/polymine')
	.version(packageJson.version)
	.run()
	.then(async () => {
	// Listen for broadcast pings from minecraft clients
		const socket = dgram.createSocket({type: 'udp4'})

		socket.on('listening', () => {
			const address = socket.address()
			$out.block.broken.info(`Server discovery interval: {cyanBright}${$config.discovery_interval > 0 ? `${$config.discovery_interval}ms` : `None`}{/cyanBright}`,
				`Server ping interval: {cyanBright}${$config.ping_interval}ms{/cyanBright}`,
				`Listening for pings at {cyanBright}${address.address}:${address.port}{/cyanBright}`)
		})

		socket.on('message', (data, {port, address}) => {
			const parsed = parseUnconnectedPing(data)
			$out.verbose('Received ping from client', parsed.data)
			if (parsed) {
				$out.verbose(`Sending pongs to ${address}:${port}`)
				for (const connector of Object.values(connectors)) {
					if (connector.remoteServerID !== null) {
						const updatedServerName = connector.remoteServerName.replace(connector.privatePort, connector.publicPort)
						const pong = {
							name: 'unconnected_pong',
							params: {
								pingID: parsed.data.params.pingID,
								serverID: connector.remoteServerID,
								magic: connector.remoteServerMagic,
								serverName: updatedServerName
							}
						}
						const serialized = serializer.createPacketBuffer(pong)
						$out.verbose('Sending pong to client', pong)
						socket.send(serialized, 0, serialized.length, port, address)
					}
				}
			}
		})

		observer.start()
		socket.bind($config.port)

		beforeExit(gracefulShutdown)

		process.on('unhandledRejection', (reason, promise) => {
			$out.error('Unhandled Promise Rejection: ', reason)

			promise.then(response => {
				$out.error('Promise error response', response)
			}).catch(err => {
				$out.error('Promise rejection', err)
			}).finally(() => {
				gracefulShutdown()
			})
		})

		process.on('uncaughtException', error => {
			$out.error('Unhandled Exception: ', error)

			gracefulShutdown()
		})
	}).catch(err => $out.error(err))

function gracefulShutdown() {
	$out.info('Graceful shutdown on SIGTERM')
	for (const connector of Object.values(connectors)) {
		connector.close()
	}
	observer.close()
	process.exit()
}

// Parse an incoming unconnected ping packet
function parseUnconnectedPing(data) {
	try {
		const parsed = parser.parsePacketBuffer(data)
		if (parsed.data.name !== 'unconnected_ping') {
			$out.error(`Ignoring unexpected packet on listen port: {cyan}${parsed.data.name}{/cyan}`)
			return null
		}
		return parsed
	} catch (error) {
		$out.error(`Listener: Ignoring unexpected/invalid packet on listen port. Do you have a client that has a manually configured server pointing to port 19132?`)
		return null
	}
}
