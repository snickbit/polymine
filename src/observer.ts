import {$out} from './common'
import EventEmitter from 'events'
import Docker from 'dockerode'

export default class Observer extends EventEmitter {
	private readonly discoveryInterval: any
	private docker: any
	private updateTimeout: NodeJS.Timeout | null
	private readonly servers: Record<string, ObserverServer>

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

	addServer(server) {
		const existing = this.servers[server.id]
		if (existing) {
			if (!existing.equalTo(server)) {
				this.removeServer(existing)
				this.servers[server.id] = server
				this.emit('serverAdded', server)
			}
		} else {
			this.servers[server.id] = server
			this.emit('serverAdded', server)
		}
	}

	removeServer(server) {
		delete this.servers[server.id]
		this.emit('serverRemoved', server)
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
			.map(info => new ObserverServer(info))

		for (const [id, server] of Object.entries(this.servers)) {
			if (!active_servers.find(s => s.id === id)) {
				this.removeServer(server)
			}
		}

		for (const active_server of active_servers) {
			this.addServer(active_server)
		}
		this.emit('updated')

		clearTimeout(this.updateTimeout)
		if (this.discoveryInterval > 0) {
			this.updateTimeout = setTimeout(this.update.bind(this), this.discoveryInterval)
		}
	}
}

interface ServerInfo {
	Id: string
	Name?: string
	Config?: {
		Labels: {
			[key: string]: string
		}
	}
	NetworkSettings: {
		Ports: {
			[key: string]: {
				HostIp: string
				HostPort: string
			}[]
		}
		Networks: {
			[key: string]: {
				IPAddress: string
			}
		}
	}
}

class ObserverServer {
	private readonly name: string
	private readonly ipAddress: string
	private readonly internalPort: number
	private portMappings: ObserverPortMapping[]
	id: any

	constructor(info: ServerInfo) {
		this.id = info.Id
		this.name = info.Name || 'Unknown'
		this.ipAddress = null
		this.internalPort = null
		this.portMappings = []

		const configuredInternalPort = info.Config.Labels['polymine.internal-port']
		if (configuredInternalPort) {
			this.internalPort = parseInt(configuredInternalPort)
		}

		for (const [key, entries] of Object.entries(info.NetworkSettings.Ports)) {
			if (key && entries) {
				const matches = key.match(/^(\d+)\/udp$/)
				if (matches) {
					const internalPort = parseInt(matches[1])
					if (entries.length > 0 && entries[0].HostPort) {
						this.portMappings.push(new ObserverPortMapping(internalPort, parseInt(entries[0].HostPort)))
					}
				}
			}
		}

		for (const network of Object.values(info.NetworkSettings.Networks)) {
			if (network.IPAddress) {
				this.ipAddress = network.IPAddress
				break
			}
		}
	}

	equalTo(other): boolean {
		return this.id === other.id &&
			this.name === other.name &&
			this.ipAddress === other.ipAddress &&
			this.internalPort === other.internalPort &&
			this.portMappings.length === other.portMappings.length &&
			this.portMappings.every((m, i) => m.equalTo(other.portMappings[i]))
	}
}

class ObserverPortMapping {
	private readonly privatePort: any
	private readonly publicPort: any

	constructor(privatePort, publicPort) {
		this.privatePort = privatePort
		this.publicPort = publicPort
	}

	equalTo(other): boolean {
		return this.privatePort === other.privatePort && this.publicPort === other.publicPort
	}
}
