export class PortMapping {
	readonly privatePort: any
	readonly publicPort: any

	constructor(privatePort, publicPort) {
		this.privatePort = privatePort
		this.publicPort = publicPort
	}

	equalTo(other): boolean {
		return this.privatePort === other.privatePort && this.publicPort === other.publicPort
	}
}
