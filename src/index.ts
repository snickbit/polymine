#!/usr/bin/env node
import {cli} from '@snickbit/node-cli'
import {$config, $out, cleanServerName, connectors, observer, parser, serializer} from './common'
import {beforeExit} from '@snickbit/node-utilities'
import packageJson from '../package.json'
import Connector from './connector'
import dgram from 'dgram'

cli()
	.name('@snickbit/miner')
	.version(packageJson.version)
	.run()
	.then(async () => {
	// Handle a server being added
		observer.on('serverAdded', server => {
			const server_name = cleanServerName(server.name)

			$out.info(`Server added: {greenBright}${server_name}{/greenBright} ({magentaBright}${server.id}{/magentaBright})`)

			if (server.ipAddress) {
				let internalPort = $config.port

				// Has the server been configured to run on a non-default port
				if (server.internalPort !== null) {
					$out.info(`Server {greenBright}${server_name}{/greenBright} configured to use internal port {cyanBright}${server.internalPort}{/cyanBright}`)
					internalPort = server.internalPort
				}

				// Find the mapping for the internal server port
				let portMapping = server.portMappings.find(portMapping => portMapping.privatePort === internalPort)

				// Default to using the only port mapping there is
				if (!portMapping && server.portMappings.length === 1) {
					portMapping = server.portMappings[0]
				}

				if (portMapping) {
					$out.info(`Server {greenBright}${server_name}{/greenBright} is running on internal port {cyanBright}${portMapping.privatePort}{/cyanBright} and external port {cyanBright}${portMapping.publicPort}{/cyanBright}`)
					const connector = new Connector(
						server.name, server.ipAddress, portMapping.privatePort, portMapping.publicPort, $config.ping_interval, parser, serializer
					)
					connectors[server.id] = connector
					connector.on('changed', (oldState, newState) => {
						$out.info(`{greenBright}${connector.name}{/greenBright} ({cyan}${connector.address}{/cyan}) changed state from {magentaBright}${oldState}{/magentaBright} to {magentaBright}${newState}{/magentaBright}`)
					})
					connector.on('error', error => {
						$out.error(`{greenBright}${connector.name}{/greenBright} ({cyan}${connector.address}{/cyan}) ${error.message}`)
					})
				} else {
					$out.error(`Server {greenBright}${server_name}{/greenBright} has no mapping for internal port {cyan}${internalPort}{/cyan}`)
				}
			} else {
				$out.error(`Server {greenBright}${server_name}{/greenBright} has no ip address`)
			}
		})

		// Handle a server being removed
		observer.on('serverRemoved', server => {
			const server_name = cleanServerName(server.name)

			$out.info(`Server removed: {greenBright}${server_name}{/greenBright} ({magentaBright}${server.id}{/magentaBright})`)
			const connector = connectors[server.id]
			if (connector) {
				connector.close()
				delete connectors[server.id]
			}
		})

		// Listen for broadcast pings from minecraft clients
		const socket = dgram.createSocket({type: 'udp4'})

		socket.on('listening', () => {
			const address = socket.address()
			$out.block.broken.info(`Server discovery interval: {cyanBright}${$config.discovery_interval > 0 ? `${$config.discovery_interval}ms` : `None`}{/cyanBright}`,
				`Server ping interval: {cyanBright}${$config.ping_interval}ms{/cyanBright}`,
				`Listening for pings at {cyanBright}${address.address}:${address.port}{/cyanBright}`)
		})

		socket.on('message', (data, {port, address}) => {
			handleClientPing(socket, address, port, data)
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

// Respond to a ping from a minecraft client
function handleClientPing(socket, address, port, data) {
	const parsed = parseUnconnectedPing(data)
	$out.verbose('Received ping from client', parsed)
	if (parsed) {
		for (const connector of Object.values(connectors)) {
			if (connector.remoteServerID !== null) {
				const updatedServerName = connector.remoteServerName.replace(connector.privatePort, connector.publicPort)
				const serialized = serializer.createPacketBuffer({
					name: 'unconnected_pong',
					params: {
						pingID: parsed.data.params.pingID,
						serverID: connector.remoteServerID,
						magic: connector.remoteServerMagic,
						serverName: updatedServerName
					}
				})
				$out.verbose('Sending pong to client', serialized)
				socket.send(serialized, 0, serialized.length, port, address)
			}
		}
	}
}
