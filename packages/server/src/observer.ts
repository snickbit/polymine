import {$config, $out, connectors, parser, serializer} from './common'
import {Server} from './server'
import EventEmitter from 'events'
import Docker from 'dockerode'
import Connector from './connector'

export default class Observer extends EventEmitter {
	private readonly discoveryInterval: any
	private docker: any
	private updateTimeout: NodeJS.Timeout | null
	private readonly servers: Record<string, Server>

	constructor(discoveryInterval) {
		super()
		this.discoveryInterval = discoveryInterval
		this.docker = new Docker({socketPath: '/var/run/docker.sock'})
		this.updateTimeout = null
		this.servers = {}
	}

	start() {
		this.update().catch(() => {
			$out.error('Failed to update servers on start')
		})
	}

	addServer(server: Server) {
		const existing = this.servers[server.id]
		if (existing) {
			if (!existing.equalTo(server)) {
				this.removeServer(existing)
				this.servers[server.id] = server
				this.serverAdded(server)
			}
		} else {
			this.servers[server.id] = server
			this.serverAdded(server)
		}
	}

	protected serverAdded(server: Server) {
		server.out.info(`Server added: ({magentaBright}${server.id}{/magentaBright})`)

		if (server.ipAddress) {
			let internalPort = $config.port

			// Has the server been configured to run on a non-default port
			if (server.internalPort !== null) {
				server.out.info(`Server configured to use internal port {cyanBright}${server.internalPort}{/cyanBright}`)
				internalPort = server.internalPort
			}

			// Find the mapping for the internal server port
			let portMapping = server.portMappings.find(portMapping => portMapping.privatePort === internalPort)

			// Default to using the only port mapping there is
			if (!portMapping && server.portMappings.length === 1) {
				portMapping = server.portMappings[0]
			}

			if (portMapping) {
				server.out.info(`Server is running on internal port {cyanBright}${portMapping.privatePort}{/cyanBright} and external port {cyanBright}${portMapping.publicPort}{/cyanBright}`)
				const connector = new Connector(
					server.name, server.ipAddress, portMapping.privatePort, portMapping.publicPort, $config.ping_interval, parser, serializer
				)
				connectors[server.id] = connector
				connector.on('changed', (oldState, newState) => {
					server.out.info(`Changed state from {magentaBright}${oldState}{/magentaBright} to {magentaBright}${newState}{/magentaBright}`)
				})
				connector.on('error', error => {
					server.out.error(error.message)
				})
			} else {
				server.out.error(`Server has no mapping for internal port {cyan}${internalPort}{/cyan}`)
			}
		} else {
			server.out.error(`Server has no ip address`)
		}
	}

	protected serverRemoved(server: Server) {
		server.out.info(`Server removed: ({magentaBright}${server.id}{/magentaBright})`)
		const connector = connectors[server.id]
		if (connector) {
			connector.close()
			delete connectors[server.id]
		}
	}

	removeServer(server) {
		delete this.servers[server.id]
		this.serverRemoved(server)
	}

	close() {
		clearTimeout(this.updateTimeout)
	}

	async update() {
		const containerList = await this.docker.listContainers()
		const containerData = await Promise.all(containerList.map(async info => {
			const container = await this.docker.getContainer(info.Id)
			return container.inspect()
		}))

		const active_servers = containerData
			.filter(info => info.State.Status === 'running' && info.Config.Labels['polymine.enable'] === 'true')
			.map(info => new Server(info))

		for (const [id, server] of Object.entries(this.servers)) {
			if (!active_servers.find(s => s.id === id)) {
				this.removeServer(server)
			}
		}

		for (const active_server of active_servers) {
			this.addServer(active_server)
		}

		clearTimeout(this.updateTimeout)
		if (this.discoveryInterval > 0) {
			this.updateTimeout = setTimeout(this.update.bind(this), this.discoveryInterval)
		}
	}
}

